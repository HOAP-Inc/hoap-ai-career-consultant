import { findMustHaveTagIds } from "../tags";
import type { Meta, Status } from "../../models/state";

type Step4Result = {
  status: Pick<Status, "must_have_ids">;
  meta: Meta;
};

export function runStep4Adapter(userMessage: string): Step4Result {
  const mustHaveIds = findMustHaveTagIds(userMessage);
  return {
    status: { must_have_ids: mustHaveIds },
    meta: { step: 5 },
  };
}
