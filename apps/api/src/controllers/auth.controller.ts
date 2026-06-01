import {
    Body,
    Controller,
    Get,
    Post,
    Req,
    Res,
    UseGuards,
  } from '@nestjs/common';
  import type { Response } from 'express';
  import { LoginDto } from '../dto/auth/login.dto';
  import { RegisterUseCase } from '@application/use-cases/auth/register.usecase';
  import { LoginUseCase } from '@application/use-cases/auth/login.usecase';
  import { GetCurrentUserUseCase } from '@application/use-cases/auth/get-current-user.usecase';
import { CurrentUser } from '../decorators/current-user.decorator';
import { RequestUser } from '../types/request-user.type';
import { AuthGuard } from '../guards/auth.guard';
import { RegisterDto } from '../dto/auth/register.dto';
  
  @Controller('auth')
  export class AuthController {
    constructor(
      private readonly registerUseCase: RegisterUseCase,
      private readonly loginUseCase: LoginUseCase,
      private readonly getCurrentUserUseCase: GetCurrentUserUseCase,
    ) {}
  
    @Post('register')
    async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
      const result = await this.registerUseCase.execute(dto);
  
      this.attachSessionCookieIfNeeded(res, result.auth);
  
      return {
        success: true,
        data: result,
      };
    }
  
    @Post('login')
    async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
      const result = await this.loginUseCase.execute(dto);
  
      this.attachSessionCookieIfNeeded(res, result.auth);
  
      return {
        success: true,
        data: result,
      };
    }
  
    @UseGuards(AuthGuard)
    @Get('me')
    async me(@CurrentUser() user: RequestUser) {
      const result = await this.getCurrentUserUseCase.execute(user.id);
  
      return {
        success: true,
        data: result,
      };
    }
  
    private attachSessionCookieIfNeeded(
      res: Response,
      auth: {
        accessToken?: string;
        refreshToken?: string;
        sessionId?: string;
        expiresAt?: Date;
      },
    ): void {
      if (!auth.sessionId) {
        return;
      }
  
      res.cookie('sid', auth.sessionId, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        expires: auth.expiresAt,
      });
    }
  }