export type Status = {
  qual_ids?: number[];
  can_text?: string;
  will_text?: string;
  must_have_ids?: number[];
  must_have_text?: string;
  self_text?: string;
  doing_text?: string;
  being_text?: string;
};

export type Phase = "intro" | "empathy" | "deepening" | "generation";

export type Meta = {
  step: number;
  phase?: Phase;
};
