import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { CashSessionService } from './cash-session.service';
import { CashSessionController, OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [InventoryModule],
  controllers: [OrdersController, CashSessionController],
  providers: [OrdersService, CashSessionService],
  exports: [OrdersService],
})
export class OrdersModule {}
