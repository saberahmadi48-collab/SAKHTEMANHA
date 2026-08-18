import { Module } from '@nestjs/common';

import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

/**
 * BM-02 §41 — self-service profile.
 *
 * The only module in the application whose routes are authenticated but carry
 * no tenant scope, because a person's identity exists independently of any
 * building (BM-02 §6: a User answers "who may authenticate", a Person answers
 * "who is this in the domain").
 *
 * Exported so BM-07 notifications can resolve a recipient's `locale` and
 * contact-consent flag through the same service that owns those fields, rather
 * than reading the Person table directly and re-deriving the privacy rules.
 */
@Module({
  controllers: [ProfileController],
  providers: [ProfileService],
  exports: [ProfileService],
})
export class ProfileModule {}
