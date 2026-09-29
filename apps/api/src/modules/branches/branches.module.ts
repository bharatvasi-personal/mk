import { Module } from '@nestjs/common';
import { BranchesController, UsersController } from './branches.controller';
import { BranchesService } from './branches.service';

@Module({
  controllers: [BranchesController, UsersController],
  providers: [BranchesService],
  exports: [BranchesService],
})
export class BranchesModule {}
