/** Split a lead's name into first/last for display. Pure — safe on the client. */

/**
 * Prefer the form's own split fields (nombre/apellido or first/last name);
 * fall back to splitting the stored full name on the first space.
 */
export function leadNameParts(
  name: string | null | undefined,
  formData?: Record<string, unknown> | null,
): { first: string; last: string } {
  const get = (keys: string[]) => {
    for (const k of keys) {
      const v = formData?.[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  };
  const first = get(["first_name", "nombre"]);
  const last = get(["last_name", "apellido"]);
  if (first || last) return { first: first ?? "", last: last ?? "" };

  const parts = (name ?? "").trim().split(/\s+/);
  if (parts.length <= 1) return { first: parts[0] ?? "", last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}
