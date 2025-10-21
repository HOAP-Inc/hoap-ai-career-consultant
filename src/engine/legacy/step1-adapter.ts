import { extractQualificationIdsFromText } from "../tags";
import type { Meta, Status } from "../../models/state";

type Step1Result = {
  status: Pick<Status, "qual_ids">;
  meta: Meta;
};

export function runStep1Adapter(userMessage: string): Step1Result {
  const qualIds = extractQualificationIdsFromText(userMessage);
  return {
    status: { qual_ids: qualIds },
    meta: { step: 2 },
  };
}
