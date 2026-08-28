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
import { MongoDbService } from '../../common/mongodb.service';
import { RedisService } from '../../common/redis.service';

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
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

  constructor(
    private readonly codeRunnerService: CodeRunnerService,
    private readonly prisma: PrismaService,
    private readonly mlService: MlService,
    private readonly mongodb: MongoDbService,
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

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
    // Remove from all rooms and notify
    this.rooms.forEach((members, sessionId) => {
      if (members.has(client.id)) {
        const userId = members.get(client.id);
        members.delete(client.id);
        this.server.to(sessionId).emit('user_left', { userId });
      }
    });
  }

  @SubscribeMessage('join_room')
  async handleJoinRoom(
    @MessageBody() data: { sessionId: string; userId: string },
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

    // Join the Socket.IO room
    client.join(sessionId);

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
    this.server.to(sessionId).emit('room_state', { members: memberIds });
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
    @MessageBody() data: { sessionId: string; code: string; userId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { sessionId, code } = data;
    const userId = client.data.userId;
    if (!this.isInRoom(client, sessionId)) return;

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
    @MessageBody() data: { sessionId: string; userId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { sessionId } = data;
    const userId = client.data.userId;
    if (!this.isInRoom(client, sessionId)) return;

    // Get session members and swap roles in DB
    const members = await this.prisma.pairSessionMember.findMany({
      where: { sessionId },
    });

    const newRoles: Record<string, string> = {};
    for (const member of members) {
      const newRole = member.role === 'DRIVER' ? 'NAVIGATOR' : 'DRIVER';
      await this.prisma.pairSessionMember.update({
        where: { id: member.id },
        data: { role: newRole },
      });
      newRoles[member.userId] = newRole;
    }

    // Broadcast new roles to everyone
    this.server.to(sessionId).emit('role_switch', { roles: newRoles });

    // Log event
    await this.logEvent(sessionId, userId, 'ROLE_SWITCH', { newRoles });
  }

  @SubscribeMessage('discussion_note')
  async handleDiscussionNote(
    @MessageBody() data: { sessionId: string; note: string; userId: string; userName?: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { sessionId, note, userName } = data;
    const userId = client.data.userId;
    if (!this.isInRoom(client, sessionId)) return;

    // Broadcast to others in room (sender adds locally)
    client.to(sessionId).emit('discussion_note', {
      note,
      userId,
      userName: userName || 'Partner',
      timestamp: new Date().toISOString(),
    });

    // Log event
    await this.logEvent(sessionId, userId, 'DISCUSSION_NOTE', { note });
  }

  @SubscribeMessage('run_code')
  async handleRunCode(
    @MessageBody() data: { sessionId: string; code: string; userId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { sessionId, code } = data;
    const userId = client.data.userId;
    if (!this.isInRoom(client, sessionId)) return;

    this.lastCode.set(sessionId, code);

    // Log the run attempt
    await this.logEvent(sessionId, userId, 'CODE_RUN', { codeLength: code.length });

    // Actually compile and run the Java code
    try {
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
    }
  }

  @SubscribeMessage('intervention_response')
  async handleInterventionResponse(
    @MessageBody() data: { sessionId: string; interventionId: string; accepted: boolean },
    @ConnectedSocket() client: Socket,
  ) {
    const { sessionId, interventionId, accepted } = data;
    if (!this.isInRoom(client, sessionId)) return;

    // Update intervention in DB if it exists
    if (interventionId) {
      try {
        await this.prisma.intervention.update({
          where: { id: interventionId },
          data: { accepted },
        });
      } catch {
        // Intervention may not exist in DB yet
      }
    }

    // Log event
    await this.logEvent(sessionId, client.data.userId, 'INTERVENTION_RESPONSE', {
      interventionId,
      accepted,
    });
  }

  @SubscribeMessage('end_session')
  async handleEndSession(
    @MessageBody() data: { sessionId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { sessionId } = data;
    if (!this.isInRoom(client, sessionId)) return;

    // Release the transient hint context — the session is over.
    this.lastError.delete(sessionId);
    this.lastCode.delete(sessionId);
    this.activeWorkCounters.delete(sessionId);

    // Broadcast to all members to redirect to review
    this.server.to(sessionId).emit('session_ended', { sessionId });
  }

  // ─── Helper Methods ──────────────────────────────────────────────

  private async logEvent(
    sessionId: string,
    userId: string,
    eventType: string,
    metadata: Record<string, any>,
  ) {
    try {
      await this.prisma.sessionEvent.create({
        data: {
          sessionId,
          userId,
          role: '',
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

      // L5: send raw events + current roles; ml-service computes features
      // with the same canonical extractor used for training data.
      const members = await this.prisma.pairSessionMember.findMany({
        where: { sessionId },
      });
      const roles: Record<string, string> = {};
      for (const m of members) roles[m.userId] = m.role;

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

      const prediction = await this.mlService.predictPairState(
        sessionId,
        recentEvents.map((e) => ({
          timestamp: e.timestamp,
          userId: e.userId,
          eventType: e.eventType,
          metadata: e.metadata,
        })),
        roles,
        lastSwitch ? lastSwitch.timestamp.getTime() / 1000 : undefined,
        session ? session.startedAt.getTime() / 1000 : undefined,
      );

      // Log prediction and the exact features it was made on (echoed back
      // by ml-service) to MongoDB for later human labeling — never as
      // training labels directly.
      await this.mongodb.logMLEvent(sessionId, {
        features: prediction?.features ?? null,
        prediction,
        timestamp: new Date(),
        source: 'real_time_prediction_engine',
      });

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
            const session = await this.prisma.pairSession.findUnique({
              where: { id: sessionId },
              include: { question: true },
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
