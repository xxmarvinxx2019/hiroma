import type { Prisma } from "@prisma/client";
import { hashIdentityDocument } from "@/app/lib/identityDocument";
import { normalizePersonName } from "@/app/lib/nameFormat";

export type PosRegistrationApplicantIdentity = {
  applicant_full_name: string;
  applicant_mobile: string;
  identity_document_hash?: string | null;
  identity_document_type?: string | null;
  identity_document_reference?: string | null;
};

type ExpectedApplicantIdentity = {
  fullName: string;
  mobile: string;
  identityDocumentHash: string;
};

export class PosRegistrationApplicantBindingError extends Error {
  constructor() {
    super(
      "The applicant identity no longer matches the released POS registration. Review the paid handoff before encoding.",
    );
    this.name = "PosRegistrationApplicantBindingError";
  }
}

export class PosRegistrationHandoffRequiredError extends Error {
  constructor() {
    super(
      "This applicant has a released POS registration. Open its paid handoff before creating the reseller account.",
    );
    this.name = "PosRegistrationHandoffRequiredError";
  }
}

export function resolvePosRegistrationIdentityHash(
  input: PosRegistrationApplicantIdentity,
) {
  if (input.identity_document_hash) return input.identity_document_hash;
  if (!input.identity_document_type || !input.identity_document_reference)
    return null;
  try {
    return hashIdentityDocument(
      input.identity_document_type,
      input.identity_document_reference,
    );
  } catch {
    return null;
  }
}

export async function lockPosRegistrationApplicant(
  tx: Prisma.TransactionClient,
  identityDocumentHash: string,
) {
  if (!/^[a-f0-9]{64}$/i.test(identityDocumentHash)) {
    throw new PosRegistrationApplicantBindingError();
  }
  const lockKey = `hiroma:pos-registration:${identityDocumentHash.toLowerCase()}`;
  await tx.$queryRaw<Array<{ locked: string }>>`
    SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS locked
  `;
}

function nameAndMobileMatch(
  input: PosRegistrationApplicantIdentity,
  expected: ExpectedApplicantIdentity,
) {
  return (
    normalizePersonName(input.applicant_full_name).toLocaleLowerCase("en-US") ===
      normalizePersonName(expected.fullName).toLocaleLowerCase("en-US") &&
    input.applicant_mobile.trim() === expected.mobile.trim()
  );
}

export function isLikelyOutstandingPosApplicant(
  input: PosRegistrationApplicantIdentity,
  expected: ExpectedApplicantIdentity,
) {
  return (
    resolvePosRegistrationIdentityHash(input) === expected.identityDocumentHash ||
    nameAndMobileMatch(input, expected)
  );
}

export function assertPosRegistrationApplicantBinding(
  input: PosRegistrationApplicantIdentity,
  expected: ExpectedApplicantIdentity,
) {
  if (
    resolvePosRegistrationIdentityHash(input) !== expected.identityDocumentHash ||
    !nameAndMobileMatch(input, expected)
  ) {
    throw new PosRegistrationApplicantBindingError();
  }
}
