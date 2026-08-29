import { Controller, Get, UseGuards } from '@nestjs/common';

import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { OperationsService, type LaunchOperationsReport } from './operations.service.js';

@Controller('admin/operations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class OperationsController {
  constructor(private readonly operationsService: OperationsService) {}

  @Get()
  getReport(): Promise<LaunchOperationsReport> {
    return this.operationsService.getReport();
  }
}
