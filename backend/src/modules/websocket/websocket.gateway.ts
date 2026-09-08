import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CodeRunnerService } from '../code-runner/code-runner.service';
import { PrismaService } from '../../common/prisma.service';
import { MlService } from '../ml/ml.service';
import { RedisService } from '../../common/redis.service';
import { corsOriginCallback } from '../../common/env';
import { isAccessToken } from '../../common/tokens';

/** Runs per student per window. Matches what the removed HTTP route declared. */
const RUN_LIMIT = 10;
const RUN_WINDOW_MS = 60_000;

@WebSocketGateway({
  cors: {
    // A callback, not a value. This decorator is evaluated when the module is
    // imported, which can be before ConfigModule has loaded .env - a literal
    // read here could capture the fallback and stay wrong for the life of the
    // process. The callback runs per handshake instead.
    origin: corsOriginCallback,
    credentials: true,
  },
})
export class WebsocketGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  @WebSocketServer()
  server: Server;

  // Track room membership: sessionId -> Set<{ socketId, userId }>
  private rooms = new Map<string, Map<string, string>>(); // socketId -> userId
  private inactivityInterval: NodeJS.Timeout;
  private activeWorkCounters = new Map<string, number>(); // sessionId -> event count

  // Recent context for hint retrieval. Without these, hint selection depends
  // entirely on how the question was tagged — a pair hitting an array error on
  // a question tagged "modulo" would receive generic advice. Held in memory
  // only; they are transient working state, not part of the research record.
  private lastError = new Map<string, string>(); // sessionId -> stderr of the last failed run
  private lastCode = new Map<string, string>(); // sessionId -> most recent editor contents

  // Who currently holds which role, by session.
  //
  // Cached rather than read per message because code_change fires on every
  // edit, and the navigator check below has to run on every one of them - a
  // database round trip per keystroke is not a check anyone would keep.
  // Roles change in exactly two places (a member joining, and a swap), so both
  // write here and nothing else can drift.
  private sessionRoles = new Map<string, Record<string, string>>(); // sessionId -> userId -> role

  /*
   * ============ WHY RUNNING CODE IS RATE LIMITED HERE ============
   * `run_code` compiles and executes a Java program. It was the only path to
   * the code runner that anything actually used - and it had no limit of any
   * kind, because the limit was on `POST /code-runner/run-java`, an endpoint
   * with no caller anywhere on the platform. The protection was on the door
   * nobody used.
   *
   * Socket messages never reach the HTTP ThrottlerGuard, so nothing counted
   * these. One client in a loop forks an unbounded number of `javac` and
   * `java` processes on the API host - each one a real compiler with real
   * memory - which is a denial of service against every other pair on the
   * server, and in `lambda` mode is an unbounded number of billed
   * invocations.
   *
   * Two separate limits, because they stop different things:
   *   RUN_LIMIT/RUN_WINDOW_MS  a per-student budget, matching the 10/min the
   *                            dead endpoint declared.
   *   runsInFlight             one run at a time per session. A student who
   *                            presses Run four times while the first is
   *                            still compiling gets one compile, not four,
   *                            and the pair is not shown four results.
   * ===============================================================
   */
  private runHistory = new Map<string, number[]>(); // userId -> recent run timestamps
  private runsInFlight = new Set<string>(); // sessionIds currently compiling

  constructor(
    private readonly codeRunnerService: CodeRunnerService,
    private readonly prisma: PrismaService,
    private readonly mlService: MlService,
    private readonly jwtService: JwtService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit() {
    // Run every 60 seconds to check for inactivity across all active sessions
    this.inactivityInterval = setInterval(() => {
      this.rooms.forEach((members, sessionId) => {
        if (members.size > 0) {
          this.triggerMlPrediction(sessionId);
        }
      });
    }, 60000);
  }

  onModuleDestroy() {
    if (this.inactivityInterval) {
      clearInterval(this.inactivityInterval);
    }
  }

  handleConnection(client: Socket) {
    // L9: verify JWT during the handshake; reject unauthenticated sockets.
    const token =
      client.handshake.auth?.token ||
      client.handshake.headers?.authorization?.replace(/^Bearer /, '');
    try {
      const payload = this.jwtService.verify(token);

      // The same rule as the REST layer. A gateway that accepted a token the
      // API refuses would be the more useful of the two doors to an attacker:
      // it carries the whole live session.
      if (!isAccessToken(payload)) {
        throw new Error('not an access token');
      }

      client.data.userId = payload.sub;
      console.log(`Client connected: ${client.id} (user ${payload.sub})`);
    } catch {
      console.log(`Client rejected (invalid/missing token): ${client.id}`);
      client.emit('auth_error', { message: 'Authentication required' });
      client.disconnect(true);
    }
  }

  /** L9: a socket may only act on a session it has joined (which requires DB membership). */
  private isInRoom(client: Socket, sessionId: string): boolean {
    return this.rooms.get(sessionId)?.has(client.id) ?? false;
  }

  /** Read the roles from the database and refresh the cache. */
  private async loadRoles(sessionId: string): Promise<Record<string, string>> {
    const members = await this.prisma.pairSessionMember.findMany({ where: { sessionId } });
    const roles: Record<string, string> = {};
    for (const member of members) roles[member.userId] = member.role;
    this.sessionRoles.set(sessionId, roles);
    return roles;
  }

  /** Cached roles, loading them once if this session has not been seen yet. */
  private async rolesFor(sessionId: string): Promise<Record<string, string>> {
    return this.sessionRoles.get(sessionId) ?? this.loadRoles(sessionId);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
    // Remove from all rooms and notify
    this.rooms.forEach((members, sessionId) => {
      if (members.has(client.id)) {
        const userId = members.get(client.id);
        members.delete(client.id);
        this.server.to(sessionId).emit('user_left', { userId });
      }

      // Drop the room once it is empty. Without this every session ever joined
      // stays in the map for the life of the process, and the 60s sweep in
      // onModuleInit walks all of them forever.
      if (members.size === 0) {
        this.rooms.delete(sessionId);
        this.sessionRoles.delete(sessionId);
        this.runsInFlight.delete(sessionId);
      }
    });

    // Run budgets are keyed by student, not by session, so nothing above
    // reaches them. Left alone the map keeps one entry for every student who
    // has ever connected to this process; a student who reconnects inside the
    // window simply starts with a fresh budget, which costs at most RUN_LIMIT
    // extra runs and is not worth tracking sockets to prevent.
    const userId = client.data?.userId;
    if (userId && !this.hasOtherSocket(client.id, userId)) {
      this.runHistory.delete(userId);
    }
  }

  /**
   * Is anybody currently in this session's room?
   *
   * Read by the idle sweep so a pair sitting quietly - reading, talking,
   * thinking - is not closed out from under them. This process's rooms only:
   * behind more than one instance a session held open elsewhere looks empty
   * here, so the sweep treats this as one signal and not the only one.
   */
  hasLiveMembers(sessionId: string): boolean {
    return (this.rooms.get(sessionId)?.size ?? 0) > 0;
  }

  /** Is this student still connected on some other socket? */
  private hasOtherSocket(socketId: string, userId: string): boolean {
    for (const members of this.rooms.values()) {
      for (const [id, uid] of members) {
        if (uid === userId && id !== socketId) return true;
      }
    }
    return false;
  }

  @SubscribeMessage('join_room')
  async handleJoinRoom(
    @MessageBody() data: { sessionId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { sessionId } = data;
    // L9: identity comes from the verified handshake, never the message body.
    const userId = client.data.userId;

    // L9: only actual session members may join the room.
    const membership = await this.prisma.pairSessionMember.findFirst({
      where: { sessionId, userId },
    });
    if (!membership) {
      client.emit('auth_error', { message: 'Not a member of this session' });
      return;
    }

    /*
     * And only while it is still running.
     *
     * join_room writes a JOIN event and opens the socket to code_change,
     * run_code and discussion_note - all of which append to the behavioural
     * record. Nothing stopped a student reopening /pair/:id for a session
     * that ended days ago and adding events after endedAt, which makes the
     * session's own timeline incoherent and puts edits in a window the model
     * would read as activity.
     *
     * This is the reason watch_session exists as a separate message: the
     * results page needs the room without being session activity. The rule it
     * implies was never enforced on join_room itself.
     */
    const session = await this.prisma.pairSession.findUnique({
      where: { id: sessionId },
      select: { status: true },
    });
    if (session?.status !== 'ACTIVE') {
      client.emit('session_closed', {
        sessionId,
        message: 'This session has finished. Its record is read-only.',
      });
      return;
    }

    // Join the Socket.IO room
    client.join(sessionId);

    // Roles are part of joining, not a separate fetch. The client needs them
    // before the first keystroke to know whether this student may type at all.
    const roles = await this.loadRoles(sessionId);

    // Track membership
    if (!this.rooms.has(sessionId)) {
      this.rooms.set(sessionId, new Map());
    }
    this.rooms.get(sessionId)!.set(client.id, userId);

    // Log event to database
    await this.logEvent(sessionId, userId, 'JOIN', {});

    // Notify others
    client.to(sessionId).emit('user_joined', { userId });

    // Send current room state
    const memberIds = Array.from(this.rooms.get(sessionId)!.values());
    this.server.to(sessionId).emit('room_state', { members: memberIds, roles });
  }

  /**
   * Join a session room to receive post-session updates (e.g. the partner
   * submitting their review) without being an active participant. Deliberately
   * logs no SessionEvent — the session is over and these joins must not
   * pollute the behavioural record used for feature extraction.
   */
  @SubscribeMessage('watch_session')
  async handleWatchSession(
    @MessageBody() data: { sessionId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { sessionId } = data;
    const userId = client.data.userId;

    const membership = await this.prisma.pairSessionMember.findFirst({
      where: { sessionId, userId },
    });
    if (!membership) {
      client.emit('auth_error', { message: 'Not a member of this session' });
      return;
    }

    client.join(sessionId);
  }

  /** Notify a session room that someone submitted their review. */
  notifyReviewSubmitted(sessionId: string, payload: { userId: string }) {
    this.server?.to(sessionId).emit('review_submitted', payload);
  }

  /**
   * Connected sockets in a session held by whoever currently has the given
   * role ('navigator' | 'driver'). Returns an empty list when that student
   * isn't connected, so callers can decline to fire rather than sending a
   * targeted nudge into the void.
   */
  private socketsWithRole(
    sessionId: string,
    roles: Record<string, string>,
    audience: string,
  ): string[] {
    const members = this.rooms.get(sessionId);
    if (!members) return [];
    const wanted = audience.toUpperCase();
    const sockets: string[] = [];
    members.forEach((userId, socketId) => {
      if (roles[userId] === wanted) sockets.push(socketId);
    });
    return sockets;
  }

  @SubscribeMessage('code_change')
  async handleCodeChange(
    @MessageBody() data: { sessionId: string; code: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { sessionId, code } = data;
    const userId = client.data.userId;
    if (!this.isInRoom(client, sessionId)) return;

    /*
     * Only the driver types. This is a platform constraint, not a UI
     * preference - docs/annotation-codebook.md and the state definitions both
     * rest on it: because every edit comes from the driver by construction,
     * edit share carries no signal and driver dominance is identified by
     * rotation timing instead.
     *
     * It has to be enforced here rather than only by a read-only editor,
     * because three of the model's fifteen features - driver_edit_count,
     * navigator_edit_count, edit_balance_ratio - are computed from these
     * events. A client that ignores the constraint does not just misbehave;
     * it writes rows that contradict what the model was trained on.
     */
    const roles = await this.rolesFor(sessionId);
    if (roles[userId] === 'NAVIGATOR') {
      // Said out loud rather than dropped. A client whose view of the roles
      // has drifted would otherwise type into a void with no explanation.
      client.emit('edit_rejected', {
        message: "The navigator's editor is read-only. Swap roles to take the keyboard.",
      });
      return;
    }

    this.lastCode.set(sessionId, code);

    // Broadcast to others in room (not sender)
    client.to(sessionId).emit('code_update', { code, userId });

    // Log event
    await this.logEvent(sessionId, userId, 'CODE_EDIT', {
      codeLength: code.length,
    });
  }

  @SubscribeMessage('role_switch')
  async handleRoleSwitch(
    @MessageBody() data: { sessionId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { sessionId } = data;
    const userId = client.data.userId;
    if (!this.isInRoom(client, sessionId)) return;

    // The role held before the swap, for the event row below.
    const roleBefore = (await this.rolesFor(sessionId))[userId];

    // Get session members and swap roles in DB
    const members = await this.prisma.pairSessionMember.findMany({
      where: { sessionId },
    });

    // A swap is only meaningful between two people. Flipping a lone member
    // makes them the navigator of an empty pair - and since the navigator's
    // editor is read-only, that left the session with nobody able to type.
    if (members.length !== 2) {
      client.emit('role_switch_rejected', {
        message: 'Both partners need to have joined before you can swap roles.',
      });
      return;
    }

    const newRoles: Record<string, string> = {};
    for (const member of members) {
      const newRole = member.role === 'DRIVER' ? 'NAVIGATOR' : 'DRIVER';
      await this.prisma.pairSessionMember.update({
        where: { id: member.id },
        data: { role: newRole },
      });
      newRoles[member.userId] = newRole;
    }
    this.sessionRoles.set(sessionId, newRoles);

    // Broadcast new roles to everyone
    this.server.to(sessionId).emit('role_switch', { roles: newRoles });

    // Log event
    await this.logEvent(sessionId, userId, 'ROLE_SWITCH', { newRoles }, roleBefore);
  }

  @SubscribeMessage('discussion_note')
  async handleDiscussionNote(
    @MessageBody() data: { sessionId: string; note?: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { sessionId } = data;
    const userId = client.data.userId;
    if (!this.isInRoom(client, sessionId)) return;

    /*
     * An empty note is not an event.
     *
     * discussion_note_count and navigator_note_count are two of the model's
     * fifteen features, and DISENGAGED is separated from PRODUCTIVE partly by
     * them - so a row logged for a message with no text raises the pair's
     * apparent engagement without anyone having said anything. That is exactly
     * what was happening: the unified client sent the text under the key
     * `message` while this handler read `note`, so every message logged an
     * event whose metadata was `{}` and broadcast `note: undefined` to the
     * partner. The count went up; the words were never stored or delivered.
     *
     * The wire name is `note` - see docs/inter-service-events.md - and this
     * now refuses to record one that is not there.
     */
    const note = (data?.note ?? '').trim();
    if (!note) return;

    // Broadcast to others in room (sender adds locally). The identity comes
    // from the verified handshake; `userName` used to be taken from the
    // message body, which let a client label its own messages as anyone.
    client.to(sessionId).emit('discussion_note', {
      note,
      userId,
      timestamp: new Date().toISOString(),
    });

    // Log event
    await this.logEvent(sessionId, userId, 'DISCUSSION_NOTE', { note });
  }

  @SubscribeMessage('run_code')
  async handleRunCode(
    @MessageBody() data: { sessionId: string; code: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { sessionId, code } = data;
    const userId = client.data.userId;
    if (!this.isInRoom(client, sessionId)) return;

    if (typeof code !== 'string') return;

    // Already compiling for this pair. Told to the one who asked, not to the
    // room - the partner has no reason to see a message about a button they
    // did not press.
    if (this.runsInFlight.has(sessionId)) {
      client.emit('run_rejected', {
        reason: 'busy',
        message: 'Your code is still running. One at a time.',
      });
      return;
    }

    if (!this.allowRun(userId)) {
      client.emit('run_rejected', {
        reason: 'rate_limited',
        message: `That is ${RUN_LIMIT} runs in a minute. Give it a moment before running again.`,
      });
      return;
    }

    /*
     * Claimed here, before the first `await`, and not next to the runJava call
     * it guards.
     *
     * Two run_code messages arriving in the same tick would otherwise both
     * pass the check above: the first suspends at the logEvent round trip
     * having claimed nothing, and the second finds the flag still unset. That
     * window is a database write wide, which is most of the race. Setting it
     * while the handler is still synchronous means the second message cannot
     * observe anything but the claim.
     */
    this.runsInFlight.add(sessionId);

    try {
      this.lastCode.set(sessionId, code);

      // Log the run attempt
      await this.logEvent(sessionId, userId, 'CODE_RUN', { codeLength: code.length });

      // Actually compile and run the Java code
      const result = await this.codeRunnerService.runJava({ code });

      // Broadcast result to everyone in room
      this.server.to(sessionId).emit('code_result', result);

      // Keep the failure text for hint retrieval; clear it on success so a hint
      // never cites an error the pair has already fixed.
      if (result.success) {
        this.lastError.delete(sessionId);
      } else {
        this.lastError.set(sessionId, result.compileError || result.stderr || '');
      }

      // Log the result
      await this.logEvent(sessionId, userId, 'CODE_RUN_RESULT', {
        success: result.success,
        hasError: !!result.compileError || !!result.stderr,
      });

      // If failed, trigger ML prediction for possible LOGIC_STRUGGLE
      if (!result.success) {
        this.triggerMlPrediction(sessionId);
      }
    } catch (error) {
      this.server.to(sessionId).emit('code_result', {
        success: false,
        stdout: '',
        stderr: 'Internal error running code',
        compileError: null,
      });
    } finally {
      // In a finally, so a runner that throws does not leave the session
      // permanently unable to run anything again.
      this.runsInFlight.delete(sessionId);
    }
  }

  /**
   * Has this student got a run left in the current window?
   *
   * A sliding window rather than a fixed one: with fixed buckets a student can
   * spend the whole budget at the end of one minute and the whole of the next
   * at the start of the following one, which is the burst this exists to stop.
   */
  private allowRun(userId: string): boolean {
    const now = Date.now();
    const recent = (this.runHistory.get(userId) ?? []).filter((t) => now - t < RUN_WINDOW_MS);

    if (recent.length >= RUN_LIMIT) {
      // Write the pruned list back even on refusal, so the timestamps of a
      // student who keeps trying cannot grow without bound.
      this.runHistory.set(userId, recent);
      return false;
    }

    recent.push(now);
    this.runHistory.set(userId, recent);
    return true;
  }

  @SubscribeMessage('intervention_response')
  async handleInterventionResponse(
    @MessageBody() data: { sessionId: string; interventionId: string; accepted: boolean },
    @ConnectedSocket() client: Socket,
  ) {
    const { sessionId, interventionId } = data;
    if (!this.isInRoom(client, sessionId)) return;

    /*
     * `accepted` is the only evidence anyone has about whether these
     * interventions land, which is the research question this component
     * exists to answer. It arrived straight from the client as `any` - the
     * inline `{ accepted: boolean }` above is a TypeScript annotation, erased
     * at runtime, and this handler is a socket message so no ValidationPipe
     * ever sees it.
     */
    if (typeof data?.accepted !== 'boolean') return;
    const accepted = data.accepted;

    if (interventionId) {
      /*
       * Scoped by session, not by id alone.
       *
       * `update({ where: { id } })` let a student in one session write the
       * outcome of an intervention in another - for a nudge they never saw.
       * updateMany with both keys simply matches nothing in that case.
       *
       * The failure is reported rather than swallowed. The old catch was
       * commented "intervention may not exist in DB yet", which is true of a
       * race with the write in triggerMlPrediction - but it also swallowed a
       * mismatched session, a type error and a dead connection identically,
       * so a systematically failing write would have looked like students
       * simply not responding.
       */
      const { count } = await this.prisma.intervention.updateMany({
        where: { id: interventionId, sessionId },
        data: { accepted },
      });

      if (count === 0) {
        console.warn(
          `Intervention ${interventionId} is not in session ${sessionId}; response discarded.`,
        );
        return;
      }
    }

    // Log event
    await this.logEvent(sessionId, client.data.userId, 'INTERVENTION_RESPONSE', {
      interventionId,
      accepted,
    });
  }

  /**
   * Tell a session room that the session is over, and release its working state.
   *
   * Called by SessionsService.end(), not by a socket message. There used to be
   * an `end_session` handler here that broadcast this WITHOUT touching the
   * database - so the room agreed the session had ended while pair_sessions
   * still said ACTIVE. Meanwhile the client that actually ends a session does
   * it over REST (POST /sessions/:id/end) and then navigates itself, so the
   * handler was never reached and the PARTNER was never told anything: they
   * sat in a live workspace on a completed session.
   *
   * One path now does both, in the order that matters - the row is COMPLETED
   * before anyone is told that it is.
   */
  notifySessionEnded(sessionId: string) {
    this.lastError.delete(sessionId);
    this.lastCode.delete(sessionId);
    this.activeWorkCounters.delete(sessionId);
    this.sessionRoles.delete(sessionId);
    this.runsInFlight.delete(sessionId);

    this.server?.to(sessionId).emit('session_ended', { sessionId });
  }

  // ─── Helper Methods ──────────────────────────────────────────────

  /**
   * Write one row of the behavioural record.
   *
   * `role` was the empty string on every event ever written. The live
   * prediction path was unaffected - it sends the current role map alongside
   * the events - but the stored column is what anyone reading the corpus back
   * has to work from, and it said nothing. A session whose events cannot be
   * attributed to a driver or a navigator cannot be annotated against
   * docs/annotation-codebook.md, which is the whole purpose of keeping them.
   *
   * The role is passed in where the caller knows better than the cache does -
   * a ROLE_SWITCH is recorded against the role its author held BEFORE the
   * swap, because that is what makes "who kept the keyboard" answerable.
   */
  private async logEvent(
    sessionId: string,
    userId: string,
    eventType: string,
    metadata: Record<string, any>,
    role?: string,
  ) {
    try {
      await this.prisma.sessionEvent.create({
        data: {
          sessionId,
          userId,
          role: role ?? (await this.rolesFor(sessionId))[userId] ?? '',
          eventType,
          metadata: JSON.stringify(metadata),
        },
      });

      // Trigger ML periodically while actively working (e.g. every 30 events)
      const count = (this.activeWorkCounters.get(sessionId) || 0) + 1;
      this.activeWorkCounters.set(sessionId, count);
      
      if (count % 30 === 0) {
        this.triggerMlPrediction(sessionId);
      }
    } catch (error) {
      console.error('Failed to log event:', error);
    }
  }

  private async triggerMlPrediction(sessionId: string) {
    try {
      // Get recent events for feature extraction
      const recentEvents = await this.prisma.sessionEvent.findMany({
        where: { sessionId },
        orderBy: { timestamp: 'desc' },
        take: 50,
      });

      // Skip prediction if not enough events yet (session just started)
      if (recentEvents.length < 5) {
        return;
      }

      // L5: send raw events + current roles; ml-service computes features with
      // the same canonical extractor used for training data. These are the
      // cached roles, which is also what the extractor expects - it attributes
      // a window's edits by role as of the window END.
      const roles = await this.rolesFor(sessionId);

      const lastSwitch = await this.prisma.sessionEvent.findFirst({
        where: { sessionId, eventType: 'ROLE_SWITCH' },
        orderBy: { timestamp: 'desc' },
      });

      // Session age lets the model distinguish "no role switch yet, 2 minutes
      // in" from "no role switch, 20 minutes in" — without it those look
      // identical and productive pairs get misread as driver-dominant.
      const session = await this.prisma.pairSession.findUnique({
        where: { id: sessionId },
        select: { startedAt: true },
      });

      const prediction = await this.mlService.predictPairState({
        sessionId,
        events: recentEvents.map((e) => ({
          timestamp: e.timestamp,
          userId: e.userId,
          eventType: e.eventType,
          metadata: e.metadata,
        })),
        roles,
        lastRoleSwitchAt: lastSwitch ? lastSwitch.timestamp.getTime() / 1000 : undefined,
        sessionStartAt: session ? session.startedAt.getTime() / 1000 : undefined,
      });

      /*
       * An outage is not an observation.
       *
       * When ml-service cannot be reached, MlService answers PRODUCTIVE at 0.5
       * so a live session keeps working - and this used to file that answer in
       * pair_state_predictions with an empty feature window beside it. The row
       * is indistinguishable from a real prediction unless you notice
       * modelVersion, so a few minutes of downtime silently added a run of
       * confident PRODUCTIVE labels to the corpus that is meant to be
       * human-annotated later.
       *
       * Nothing is recorded and no intervention fires. Silence during an
       * outage is correct; a fabricated observation is not.
       */
      if (prediction?.unavailable) return;

      // Log the prediction and the exact features it was made on (echoed back
      // by ml-service) for later human labeling — never as training labels
      // directly.
      //
      // This used to go to MongoDB. It now goes to feature_windows and
      // pair_state_predictions, which have been in the Prisma schema since the
      // start and which nothing had ever written to: grep for
      // `pairStatePrediction` or `featureWindow` before this change and the
      // only hits are the model definitions. So the research trail lived in a
      // store that was optional, failed silently when absent, and was never
      // read back by anything.
      //
      // Written in one transaction because the pair is the unit of value. A
      // feature window whose prediction is missing, or a prediction whose
      // features are missing, cannot be labeled and is not worth keeping.
      if (prediction) {
        const timestamps = recentEvents.map((event) => event.timestamp);
        const windowStart = new Date(Math.min(...timestamps.map((t) => t.getTime())));
        const windowEnd = new Date(Math.max(...timestamps.map((t) => t.getTime())));

        try {
          await this.prisma.$transaction([
            this.prisma.featureWindow.create({
              data: {
                sessionId,
                windowStart,
                windowEnd,
                features: prediction.features ?? {},
              },
            }),
            this.prisma.pairStatePrediction.create({
              data: {
                sessionId,
                windowStart,
                windowEnd,
                predictedState: prediction.predictedState,
                confidence: prediction.confidence,
                modelVersion: prediction.modelVersion,
              },
            }),
          ]);
        } catch (error) {
          // Losing a research row must not take down a live session, which is
          // the one property the MongoDB version got right. Said out loud
          // rather than swallowed, because a silent gap in the corpus is
          // discovered months later when someone tries to label it.
          console.error(
            `Failed to record the ML research trail for session ${sessionId}:`,
            error,
          );
        }
      }

      // PRODUCTIVE is included: it earns a brief encouragement toast rather
      // than silence. The engine returns NO_ACTION for anything it should
      // stay quiet about, and the cooldown below rate-limits the rest.
      if (prediction) {
        // Get intervention recommendation
        const intervention = await this.mlService.recommendIntervention(
          sessionId,
          prediction.predictedState,
          prediction.confidence,
        );

        if (intervention && intervention.action !== 'NO_ACTION') {
          // Some interventions are addressed to one student rather than the
          // pair. Resolve the recipients before anything else: if the intended
          // student isn't connected there is nobody to nudge, and firing would
          // burn the cooldown on a message no one sees.
          const audience = intervention.delivery?.audience || 'pair';
          const targets =
            audience === 'pair' ? null : this.socketsWithRole(sessionId, roles, audience);
          if (targets && targets.length === 0) return;

          // L8/L11: per-session cooldown — don't fire the same intervention
          // type back-to-back; students disengage from nagging nudges.
          const canShow = await this.redis.canShowIntervention(
            sessionId,
            intervention.action,
          );
          if (!canShow) return;
          await this.redis.setInterventionCooldown(sessionId, intervention.action);

          // Save intervention to DB
          const saved = await this.prisma.intervention.create({
            data: {
              sessionId,
              state: prediction.predictedState,
              action: intervention.action,
              uiTarget: intervention.delivery?.uiTarget || 'none',
              uiEffect: intervention.delivery?.uiEffect || 'none',
              message: intervention.delivery?.message || '',
            },
          });

          const payload = {
            id: saved.id,
            state: prediction.predictedState,
            action: intervention.action,
            delivery: intervention.delivery,
          };
          if (targets) {
            for (const socketId of targets) {
              this.server.to(socketId).emit('intervention', payload);
            }
          } else {
            this.server.to(sessionId).emit('intervention', payload);
          }

          // If LOGIC_STRUGGLE, also retrieve RAG hint
          if (prediction.predictedState === 'LOGIC_STRUGGLE') {
            // Only the tags. This one is server-side - the hint is built here
            // and only the hint is emitted - but selecting the whole row would
            // pull referenceSolution into a code path that emits to clients,
            // which is one refactor away from being a leak.
            const session = await this.prisma.pairSession.findUnique({
              where: { id: sessionId },
              select: { question: { select: { conceptTags: true } } },
            });

            if (session?.question) {
              const conceptTags = (session.question.conceptTags as string[]) || [];
              const hint = await this.mlService.retrieveHint({
                sessionId,
                pairId: '',
                predictedState: 'LOGIC_STRUGGLE',
                interventionType: 'LOGIC_HINT',
                questionConceptTags: conceptTags,
                recentErrorContext: this.lastError.get(sessionId) || '',
                recentCodeSnippet: this.lastCode.get(sessionId) || '',
              });

              if (hint) {
                this.server.to(sessionId).emit('rag_hint', hint);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('ML prediction failed:', error);
    }
  }

}
