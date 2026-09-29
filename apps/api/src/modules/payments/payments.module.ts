import { Module } from '@nestjs/common';
import { PAYMENT_PROVIDER } from '../../common/payments/payment-provider';
import { RazorpayProvider } from '../../common/payments/razorpay.provider';
import { InventoryModule } from '../inventory/inventory.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [InventoryModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, { provide: PAYMENT_PROVIDER, useClass: RazorpayProvider }],
  exports: [PaymentsService],
})
export class PaymentsModule {}
