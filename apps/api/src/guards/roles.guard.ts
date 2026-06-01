import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
  } from '@nestjs/common';
  import { Reflector } from '@nestjs/core';
  import { ROLES_KEY } from '../decorators/roles.decorator';
  import type { RequestUser } from '../types/request-user.type';
  
  @Injectable()
  export class RolesGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) {}
  
    canActivate(context: ExecutionContext): boolean {
      const requiredRoles =
        this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
          context.getHandler(),
          context.getClass(),
        ]) ?? [];
  
      if (requiredRoles.length === 0) {
        return true;
      }
  
      const request = context.switchToHttp().getRequest<{
        user?: RequestUser;
      }>();
  
      const user = request.user;
  
      if (!user) {
        throw new ForbiddenException('Forbidden');
      }
  
      const hasRole = requiredRoles.some((role) => user.roles.includes(role));
  
      if (!hasRole) {
        throw new ForbiddenException('Forbidden');
      }
  
      return true;
    }
  }