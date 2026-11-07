/** A website customer's profile: what they keep on My profile, what staff see and what their receipts print. */
export interface ShopProfileFields {
  businessName: string | null;
  gstin: string | null;
  altMobile: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  landmark: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
}

export const EMPTY_PROFILE: ShopProfileFields = {
  businessName: null,
  gstin: null,
  altMobile: null,
  addressLine1: null,
  addressLine2: null,
  landmark: null,
  city: null,
  state: null,
  pincode: null,
};

/** The address as printed lines: "12 Station Road", "Opposite the bus stand", "Navsari, Gujarat 396445". */
export function profileAddressLines(p: Pick<ShopProfileFields, "addressLine1" | "addressLine2" | "landmark" | "city" | "state" | "pincode">): string[] {
  const place = [p.city, [p.state, p.pincode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [p.addressLine1, p.addressLine2, p.landmark, place || null].filter((x): x is string => !!x?.trim());
}

/** How complete the profile is, for a gentle nudge on My profile and My orders. */
export function profileComplete(p: ShopProfileFields): boolean {
  return !!(p.addressLine1 && p.city && p.state && p.pincode);
}
