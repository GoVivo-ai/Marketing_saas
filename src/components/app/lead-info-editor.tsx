"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Mail, Phone, Pencil, Check, X, Plus, Trash2, Loader2 } from "lucide-react";
import { updateLeadInfo } from "@/lib/actions/leads";
import { LeadContactActions } from "@/components/app/lead-contact-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import type { LeadRow } from "@/lib/data";
import { leadNameParts } from "@/lib/lead-name";

/** The list uses "—" as the empty sentinel; strip it for editing. */
const clean = (v: string) => (v === "—" ? "" : v);

/**
 * Form keys that duplicate the lead's name. They are edited through the
 * First/Last inputs (not as free-form field rows) and rewritten on save, so
 * displays that prefer the form's split fields (leadNameParts) can't keep
 * showing the pre-edit name.
 */
const FIRST_NAME_KEYS = ["first_name", "nombre"];
const LAST_NAME_KEYS = ["last_name", "apellido"];
const FULL_NAME_KEYS = ["full_name", "nombre_completo"];
const NAME_KEYS = [...FIRST_NAME_KEYS, ...LAST_NAME_KEYS, ...FULL_NAME_KEYS];

type Field = {
  id: number;
  key: string;
  value: string;
  /** Question label from the platform form; the key is fixed for these. */
  label?: string;
  fromForm?: boolean;
};

const humanize = (key: string) => key.replaceAll("_", " ");
const asText = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value);

/**
 * Contact (name/phone/email) + form responses for a lead, with an inline edit
 * mode. Agents fix bad or missing data the ad platform delivered. On save it
 * writes through `updateLeadInfo` and patches the parent's cached lead so the
 * open panel reflects the change without waiting for a full refetch.
 */
export function LeadInfoEditor({
  lead,
  onSaved,
}: {
  lead: LeadRow;
  onSaved: (patch: Partial<LeadRow>) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, startSave] = useTransition();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [fields, setFields] = useState<Field[]>([]);
  const nextId = useRef(0);

  const nameParts = leadNameParts(
    lead.name === "Unknown" ? "" : clean(lead.name),
    lead.formData,
  );

  // The campaign's CURRENT platform form (Meta lead-gen questions), minus the
  // name questions edited through First/Last above.
  const questions = (lead.formQuestions ?? []).filter(
    (q) => q.key && !NAME_KEYS.includes(q.key),
  );
  const questionKeys = new Set(questions.map((q) => q.key));

  const begin = () => {
    setFirstName(nameParts.first);
    setLastName(nameParts.last);
    setEmail(clean(lead.email));
    setPhone(clean(lead.phone));
    const data = lead.formData ?? {};
    setFields([
      // Every form question first — answered or blank — so agents can fill in
      // what the lead skipped without inventing the field by hand…
      ...questions.map((q) => ({
        id: nextId.current++,
        key: q.key,
        label: q.label,
        fromForm: true,
        value: q.key in data ? asText(data[q.key]) : "",
      })),
      // …then any custom/legacy field the lead carries outside the form.
      ...Object.entries(data)
        .filter(([key]) => !NAME_KEYS.includes(key) && !questionKeys.has(key))
        .map(([key, value]) => ({
          id: nextId.current++,
          key,
          value: asText(value),
        })),
    ]);
    setEditing(true);
  };

  const addField = () =>
    setFields((f) => [...f, { id: nextId.current++, key: "", value: "" }]);

  const setField = (id: number, patch: Partial<Field>) =>
    setFields((f) => f.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const removeField = (id: number) =>
    setFields((f) => f.filter((x) => x.id !== id));

  const save = () =>
    startSave(async () => {
      const name = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");
      const formData: Record<string, string> = {};
      for (const f of fields) {
        const k = f.key.trim();
        if (!k || NAME_KEYS.includes(k)) continue;
        // A blank form question stays unanswered rather than stored as "".
        if (f.fromForm && !f.value.trim()) continue;
        formData[k] = f.value;
      }
      // Rewrite the form's own name fields with the edited values so views
      // that read the name from formData agree with the new name. First/last
      // are always written (adding the key if the form never had one): the
      // stored full name can't round-trip a compound first name ("Juan
      // Pablo"), so the explicit split is the only durable record of it.
      const syncNameKeys = (
        keys: string[],
        value: string,
        addIfMissing: boolean,
      ) => {
        const existing = keys.filter((k) => k in (lead.formData ?? {}));
        if (!value) return;
        if (existing.length) for (const k of existing) formData[k] = value;
        else if (addIfMissing) formData[keys[0]] = value;
      };
      syncNameKeys(FIRST_NAME_KEYS, firstName.trim(), true);
      syncNameKeys(LAST_NAME_KEYS, lastName.trim(), true);
      syncNameKeys(FULL_NAME_KEYS, name, false);
      const res = await updateLeadInfo({
        leadId: lead.id,
        name: name || null,
        email: email || null,
        phone: phone || null,
        formData,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      onSaved({
        name: name || "Unknown",
        email: email.trim() || "—",
        phone: phone.trim() || "—",
        formData,
      });
      setEditing(false);
      router.refresh();
      toast.success("Lead updated.");
    });

  // Read view: form questions in form order (blank when unanswered), then
  // the lead's extra fields.
  const data = lead.formData ?? {};
  const entries: { key: string; label: string; value: string | null }[] = [
    ...questions.map((q) => ({
      key: q.key,
      label: q.label || humanize(q.key),
      value: q.key in data ? asText(data[q.key]) : null,
    })),
    ...Object.entries(data)
      .filter(([key]) => !questionKeys.has(key))
      .map(([key, value]) => ({ key, label: humanize(key), value: asText(value) })),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Contact &amp; form
        </h4>
        {editing ? (
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() => setEditing(false)}
              disabled={saving}
            >
              <X className="mr-1 h-3.5 w-3.5" />
              Cancel
            </Button>
            <Button size="sm" className="h-7" onClick={save} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="mr-1 h-3.5 w-3.5" />
              )}
              Save
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" className="h-7" onClick={begin}>
            <Pencil className="mr-1 h-3.5 w-3.5" />
            Edit
          </Button>
        )}
      </div>

      {/* Contact */}
      {editing ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First name"
            />
            <Input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last name"
            />
          </div>
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            type="email"
          />
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone"
            type="tel"
          />
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="grid grid-cols-2 gap-3 pb-1">
            <div>
              <p className="text-xs text-muted-foreground">First name</p>
              <p className="font-medium">{nameParts.first || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Last name</p>
              <p className="font-medium">{nameParts.last || "—"}</p>
            </div>
          </div>
          <p className="flex items-center gap-2">
            <Mail className="size-4 shrink-0 text-muted-foreground" />
            {lead.email !== "—" ? (
              <a href={`mailto:${lead.email}`} className="hover:underline">
                {lead.email}
              </a>
            ) : (
              <span className="text-muted-foreground">No email</span>
            )}
          </p>
          <p className="flex items-center gap-2">
            <Phone className="size-4 shrink-0 text-muted-foreground" />
            {lead.phone !== "—" ? (
              <a href={`tel:${lead.phone}`} className="hover:underline">
                {lead.phone}
              </a>
            ) : (
              <span className="text-muted-foreground">No phone</span>
            )}
          </p>
          <LeadContactActions
            phone={lead.phone}
            hasPhone={lead.phone !== "—"}
            email={lead.email}
          />
        </div>
      )}

      <Separator />

      {/* Form responses */}
      <div className="space-y-3 text-sm">
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Form responses
        </h4>

        {editing ? (
          <div className="space-y-2">
            {fields.map((f) =>
              f.fromForm ? (
                <div key={f.id} className="space-y-1">
                  <p
                    className="truncate text-xs text-muted-foreground"
                    title={f.key}
                  >
                    {f.label || humanize(f.key)}
                  </p>
                  <Input
                    value={f.value}
                    onChange={(e) => setField(f.id, { value: e.target.value })}
                    placeholder="Not answered"
                  />
                </div>
              ) : (
                <div key={f.id} className="flex items-start gap-2">
                  <Input
                    value={f.key}
                    onChange={(e) => setField(f.id, { key: e.target.value })}
                    placeholder="Field"
                    className="w-2/5"
                  />
                  <Input
                    value={f.value}
                    onChange={(e) => setField(f.id, { value: e.target.value })}
                    placeholder="Value"
                    className="flex-1"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-9 w-9 shrink-0 text-muted-foreground"
                    onClick={() => removeField(f.id)}
                    aria-label="Remove field"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ),
            )}
            <Button size="sm" variant="outline" className="h-8" onClick={addField}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add field
            </Button>
          </div>
        ) : entries.length > 0 ? (
          entries.map(({ key, label, value }) => (
            <div key={key} className="space-y-0.5">
              <p className="text-xs capitalize text-muted-foreground">{label}</p>
              {value != null ? (
                <p className="break-words font-medium">{value}</p>
              ) : (
                <p className="text-muted-foreground">Not answered</p>
              )}
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">No form responses.</p>
        )}
      </div>
    </div>
  );
}
