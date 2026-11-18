import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { PasswordService } from './password.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly passwords: PasswordService,
  ) {}

  async login(input: LoginDto) {
    const user = await this.prisma.user.findFirst({
      where: { email: input.email.toLowerCase(), active: true },
      include: { organization: true },
    });
    if (!user || !(await this.passwords.verify(input.password, user.passwordHash))) {
      throw new UnauthorizedException('Email hoặc mật khẩu không chính xác');
    }
    const accessToken = await this.jwt.signAsync({ sub: user.id, organizationId: user.organizationId, email: user.email });
    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        organization: { id: user.organization.id, name: user.organization.name },
      },
    };
  }

  async getCurrentUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roleAssignments: { include: { role: true } } },
    });
    if (!user || !user.active) throw new UnauthorizedException();
    const permissions = new Set<string>();
    for (const assignment of user.roleAssignments) {
      if (Array.isArray(assignment.role.permissions)) {
        for (const permission of assignment.role.permissions) {
          if (typeof permission === 'string') permissions.add(permission);
        }
      }
    }
    return {
      id: user.id,
      organizationId: user.organizationId,
      email: user.email,
      displayName: user.displayName,
      permissions: [...permissions],
      scopes: user.roleAssignments.map((item) => ({ type: item.scopeType, id: item.scopeId })),
    };
  }
}

