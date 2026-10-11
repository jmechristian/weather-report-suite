export function isMobileLine(lineType?: string | null): boolean {
  return (lineType ?? "").trim().toLowerCase() === "mobile";
}

export function isSmsEligiblePhone(input: {
  lineType?: string | null;
  dnc?: boolean | null;
  tcpa?: boolean | null;
  suppressed?: boolean | null;
  ownerDeceased?: boolean | null;
  ownerLitigator?: boolean | null;
}): boolean {
  if (input.ownerDeceased === true || input.ownerLitigator === true) return false;
  if (input.suppressed === true) return false;
  if (input.dnc !== false || input.tcpa !== false) return false;
  return isMobileLine(input.lineType);
}
