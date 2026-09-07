import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { CodeRunnerService } from './code-runner.service';
import { RunJavaDto } from './dto/run-java.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('code-runner')
@UseGuards(JwtAuthGuard)
export class CodeRunnerController {
  constructor(private readonly codeRunnerService: CodeRunnerService) {}

  @Post('run-java')
  async runJava(@Body() runJavaDto: RunJavaDto) {
    return this.codeRunnerService.runJava(runJavaDto);
  }
}
