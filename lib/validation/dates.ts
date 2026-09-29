import { z } from "zod";
import { validDate } from "@/lib/utils/dates";
export const dateSchema = z
  .string()
  .refine(validDate, "Use a valid YYYY-MM-DD calendar date.");
