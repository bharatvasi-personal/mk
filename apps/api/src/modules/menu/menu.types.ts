import type { z } from 'zod';
import type { branchMenuPriceSchema, menuCategorySchema, menuItemSchema } from '@mk/shared';

export type MenuCategoryInput = z.infer<typeof menuCategorySchema>;
export type MenuItemWriteInput = z.infer<typeof menuItemSchema>;
export type BranchMenuPriceInput = z.infer<typeof branchMenuPriceSchema>;
