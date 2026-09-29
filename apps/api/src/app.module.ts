import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AuditModule } from './common/audit/audit.module';
import { AuthGuard } from './common/auth/auth.guard';
import { TokenService } from './common/auth/token.service';
import { AllExceptionsFilter } from './common/http/all-exceptions.filter';
import { ContextMiddleware } from './common/http/context.middleware';
import { IdempotencyInterceptor } from './common/idempotency/idempotency.interceptor';
import { NotificationModule } from './common/notifications/notification.module';
import { RateLimitGuard } from './common/throttle/rate-limit.guard';
import { PrismaModule } from './common/prisma/prisma.module';
import { StorageModule } from './common/storage/storage.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { AuthModule } from './modules/auth/auth.module';
import { BranchesModule } from './modules/branches/branches.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { HealthModule } from './modules/health/health.module';
import { ImportsModule } from './modules/imports/imports.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { LegalModule } from './modules/legal/legal.module';
import { MenuModule } from './modules/menu/menu.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PublicModule } from './modules/public/public.module';
import { ReportsModule } from './modules/reports/reports.module';
import { StaffModule } from './modules/staff/staff.module';
import { VendorsModule } from './modules/vendors/vendors.module';
import { JobsModule } from './jobs/jobs.module';

/**
 * `AuthGuard` is registered globally and endpoints opt *out* with `@Public()`.
 *
 * The inverse — opting in with a guard per controller — means a new endpoint is
 * unprotected by default, and the one someone forgets will be the one that matters.
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    AuditModule,
    NotificationModule,
    StorageModule,
    AuthModule,
    BranchesModule,
    MenuModule,
    OrdersModule,
    PaymentsModule,
    InventoryModule,
    ImportsModule,
    VendorsModule,
    StaffModule,
    AttendanceModule,
    LegalModule,
    ExpensesModule,
    ReportsModule,
    PublicModule,
    HealthModule,
    JobsModule,
  ],
  providers: [
    TokenService,
    IdempotencyInterceptor,
    // Order matters: throttle before authenticating, so a flood of bad passwords is
    // rejected without paying for an Argon2 verification each time.
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ContextMiddleware).forRoutes('*');
  }
}
