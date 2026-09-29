import { Module } from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { PayrollService } from './payroll.service';
import { StaffController } from './staff.controller';

@Module({
  controllers: [StaffController],
  providers: [EmployeesService, PayrollService],
  exports: [EmployeesService, PayrollService],
})
export class StaffModule {}
