import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { CodeRunnerService } from './code-runner.service';
import { RunJavaDto } from './dto/run-java.dto';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

/**
 * Ten runs a minute. Each one compiles and executes arbitrary Java in a
 * container or a Lambda, so the request itself is the cost - and in the
 * unsandboxed development mode it runs with the API's own permissions.
 */
@Controller('code-runner')
@Throttle({ strict: { ttl: 60000, limit: 10 } })
@UseGuards(JwtAuthGuard)
export class CodeRunnerController {
  constructor(private readonly codeRunnerService: CodeRunnerService) {}

  @Post('run-java')
  async runJava(@Body() runJavaDto: RunJavaDto) {
    return this.codeRunnerService.runJava(runJavaDto);
  }
}
