import { z } from 'zod';
import { dateSchema } from './dates.mjs';
import { measurementMetadataShape,targetMetadataShape } from './nutrition.mjs';
export { dateSchema } from './dates.mjs';
export const nutrientKeys = ['energyKcal','proteinG','carbsG','fatG','fiberG','sugarG','sodiumMg','calciumMg','ironMg','potassiumMg','vitaminCMg'];
export const nutrientsSchema = z.object(Object.fromEntries(nutrientKeys.map(key => [key, z.number().min(0).max(1000000).nullable().default(null)])));
export const mealSchema = z.enum(['breakfast','lunch','dinner','snack']);
export const itemSchema = z.object({
  name: z.string().trim().min(1).max(120), grams: z.number().positive().max(20000),
  nutrients: nutrientsSchema, source: z.enum(['manual','photo','chat']).default('manual'),
  estimated: z.boolean().default(false), nutritionSource: z.string().max(300).default('用户填写'),
  photoId: z.string().max(100).nullable().default(null), note: z.string().max(500).default(''),
});
export const batchSchema = z.object({
  date: dateSchema, meal: mealSchema, idempotencyKey: z.string().min(12).max(160),
  items: z.array(itemSchema).min(1).max(30),
});
export const settingsSchema = z.object({
  dailyGoal: z.number().min(500).max(10000).nullable().default(null),
  chatModel: z.string().trim().max(150).default(''), visionModel: z.string().trim().max(150).default(''),
});
export const foodSchema = z.object({
  id: z.string().max(100).optional(), name: z.string().trim().min(1).max(120),
  emoji: z.string().max(10).default('🍽️'), nutrientsPer100g: nutrientsSchema,
  servingGrams: z.number().positive().max(20000).default(100), source: z.string().max(300).default('用户自定义'),
  favorite: z.boolean().optional(),
});

export const profileSchema = z.object({
  heightCm: z.number().min(80).max(250), weightKg: z.number().min(20).max(500),
  age: z.number().int().min(1).max(120), sex: z.enum(['male','female','undisclosed']),
  goal: z.enum(['lose','gain','maintain','recompose']), activity: z.enum(['sedentary','light','moderate','active','veryActive']).nullable().default(null),
  targetWeightKg: z.number().min(20).max(500).nullable().default(null),
});
export const measurementKeys = ['weightKg','bodyFatPct','chestCm','waistCm','armCm','hipCm','thighCm','calfCm','waterMl','steps','exerciseMinutes','exerciseKcal'];
const measurementLimits = { weightKg: [20,500], bodyFatPct: [1,80], waterMl: [0,20000], steps: [0,200000], exerciseMinutes: [0,1440], exerciseKcal: [0,20000] };
export const measurementSchema = z.object({...Object.fromEntries(measurementKeys.map(key => {
  const [min,max] = measurementLimits[key] || [5,300];
  return [key, z.number().min(min).max(max).nullable().default(null)];
})),...measurementMetadataShape});
export const targetSchema = z.object({
  nutrients: nutrientsSchema.extend({ energyKcal: z.number().min(500).max(10000).nullable() }),
  waterMl: z.number().min(0).max(10000).nullable().default(null),
  explanation: z.string().max(6000).default(''),
  ...targetMetadataShape,
});
