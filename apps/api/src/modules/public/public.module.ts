import { Module } from '@nestjs/common';
import { MenuModule } from '../menu/menu.module';
import { OrdersModule } from '../orders/orders.module';
import { PublicController } from './public.controller';

@Module({ imports: [MenuModule, OrdersModule], controllers: [PublicController] })
export class PublicModule {}
