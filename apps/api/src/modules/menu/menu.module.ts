import { Module } from '@nestjs/common';
import { MenuController } from './menu.controller';
import { MenuService } from './menu.service';
import { ModifiersController } from './modifiers.controller';
import { ModifiersService } from './modifiers.service';

@Module({
  controllers: [MenuController, ModifiersController],
  providers: [MenuService, ModifiersService],
  exports: [MenuService, ModifiersService],
})
export class MenuModule {}
