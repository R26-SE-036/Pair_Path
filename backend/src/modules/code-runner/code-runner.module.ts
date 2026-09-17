import { Module } from '@nestjs/common';
import { CodeRunnerService } from './code-runner.service';

/**
 * No controller. `POST /code-runner/run-java` used to sit here and had no
 * caller anywhere on the platform - student code is run over the socket, by
 * the gateway's `run_code` handler, so that the output can be delivered to
 * both members of the pair rather than only to whoever pressed Run.
 *
 * An unused endpoint that compiles and executes arbitrary Java is a poor
 * thing to leave standing, so the module now only provides the service the
 * gateway injects.
 */
@Module({
  providers: [CodeRunnerService],
  exports: [CodeRunnerService],
})
export class CodeRunnerModule {}
