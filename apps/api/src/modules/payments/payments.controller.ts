import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { paymentIntentSchema } from '@mk/shared';
import type { z } from 'zod';
import { AllowCustomer, Public } from '../../common/auth/decorators';
import { zodBody } from '../../common/http/zod-validation.pipe';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Public()
  @Get('status')
  @ApiOperation({ summary: 'Whether online payment is switched on (drives the checkout UI)' })
  status() {
    return { onlineEnabled: this.payments.onlineEnabled };
  }

  @AllowCustomer()
  @Post('intent')
  @HttpCode(200)
  @ApiOperation({ summary: 'Start a gateway payment for an online order' })
  intent(@Body(zodBody(paymentIntentSchema)) body: z.infer<typeof paymentIntentSchema>) {
    return this.payments.createIntent(body.orderId);
  }

  /**
   * Public because the gateway calls it, but it authenticates itself: the raw body is
   * HMAC-verified against the webhook secret before anything is read from it.
   */
  @Public()
  @Post('webhook/razorpay')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async webhook(
    @Req() req: FastifyRequest & { rawBody?: Buffer | string },
    @Headers('x-razorpay-signature') signature: string,
  ) {
    if (!signature) throw new BadRequestException('Missing signature header');
    const raw =
      typeof req.rawBody === 'string'
        ? req.rawBody
        : (req.rawBody?.toString('utf8') ?? JSON.stringify(req.body));
    return this.payments.handleWebhook(raw, signature);
  }
}
