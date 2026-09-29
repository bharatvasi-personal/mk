import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { RecipeService } from './recipe.service';
import { StockCountService } from './stock-count.service';
import { StockService } from './stock.service';

@Module({
  controllers: [InventoryController],
  providers: [InventoryService, StockService, StockCountService, RecipeService],
  exports: [InventoryService, StockService, RecipeService, StockCountService],
})
export class InventoryModule {}
