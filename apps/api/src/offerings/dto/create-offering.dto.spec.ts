import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { DeliveryMode } from '../../generated/prisma/client.js';
import { CreateOfferingDto } from './create-offering.dto.js';
import { UpdateOfferingDto } from './update-offering.dto.js';

describe('CreateOfferingDto', () => {
  it('rejects a whitespace-only name', async () => {
    const dto = plainToInstance(CreateOfferingDto, {
      name: '   ',
      deliveryMode: DeliveryMode.LIVE_AND_RECORDED,
      monthlyPrice: 10,
      courseIds: [],
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'name')).toBe(true);
  });

  it('trims a name with leading/trailing whitespace before validation', async () => {
    const dto = plainToInstance(CreateOfferingDto, {
      name: '  Grade 8 Live Bundle  ',
      deliveryMode: DeliveryMode.LIVE_AND_RECORDED,
      monthlyPrice: 10,
      courseIds: [],
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.name).toBe('Grade 8 Live Bundle');
  });

  it('accepts a genuine name', async () => {
    const dto = plainToInstance(CreateOfferingDto, {
      name: 'Grade 8 Live Bundle',
      deliveryMode: DeliveryMode.LIVE_AND_RECORDED,
      monthlyPrice: 10,
      courseIds: [],
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});

describe('UpdateOfferingDto', () => {
  it('rejects a whitespace-only name', async () => {
    const dto = plainToInstance(UpdateOfferingDto, { name: '   ' });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'name')).toBe(true);
  });

  it('allows omitting name entirely', async () => {
    const dto = plainToInstance(UpdateOfferingDto, { monthlyPrice: 20 });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});
