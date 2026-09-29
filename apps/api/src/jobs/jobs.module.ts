import { Module } from '@nestjs/common';
import { InventoryModule } from '../modules/inventory/inventory.module';
import { LegalModule } from '../modules/legal/legal.module';
import { ReportsModule } from '../modules/reports/reports.module';
import { JobsService } from './jobs.service';

@Module({ imports: [ReportsModule, LegalModule, InventoryModule], providers: [JobsService] })
export class JobsModule {}
