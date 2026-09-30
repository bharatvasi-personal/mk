import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { menuItemModifiersSchema, modifierGroupSchema } from '@mk/shared';
import type { MenuItemModifiersInput, ModifierGroupInput } from '@mk/shared';
import { RequirePermissions } from '../../common/auth/decorators';
import { zodBody } from '../../common/http/zod-validation.pipe';
import { ModifiersService } from './modifiers.service';

@ApiTags('menu')
@Controller('menu/modifiers')
export class ModifiersController {
  constructor(private readonly modifiers: ModifiersService) {}

  @Get('groups')
  @RequirePermissions('menu:read')
  groups(@Query('includeInactive') includeInactive?: string) {
    return this.modifiers.listGroups(includeInactive === 'true');
  }

  @Post('groups')
  @RequirePermissions('menu:write')
  @ApiOperation({ summary: 'Create a modifier group with its options' })
  create(@Body(zodBody(modifierGroupSchema)) body: ModifierGroupInput) {
    return this.modifiers.upsertGroup(body);
  }

  @Put('groups/:id')
  @RequirePermissions('menu:write')
  update(@Param('id') id: string, @Body(zodBody(modifierGroupSchema)) body: ModifierGroupInput) {
    return this.modifiers.upsertGroup(body, id);
  }

  @Get('item/:menuItemId')
  @RequirePermissions('menu:read')
  itemGroups(@Param('menuItemId') menuItemId: string) {
    return this.modifiers.itemGroups(menuItemId);
  }

  @Put('item')
  @RequirePermissions('menu:write')
  @ApiOperation({ summary: 'Set which modifier groups a dish shows' })
  setItem(@Body(zodBody(menuItemModifiersSchema)) body: MenuItemModifiersInput) {
    return this.modifiers.setItemGroups(body);
  }
}
