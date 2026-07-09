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

/** The list uses "—" as the empty sentinel; strip it for editing. */
const clean = (v: string) => (v === "—" ? "" : v);

type Field = { id: number; key: string; value: string };

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

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [fields, setFields] = useState<Field[]>([]);
  const nextId = useRef(0);

  const begin = () => {
    setName(lead.name === "Unknown" ? "" : clean(lead.name));
    setEmail(clean(lead.email));
    setPhone(clean(lead.phone));
    setFields(
      Object.entries(lead.formData ?? {}).map(([key, value]) => ({
        id: nextId.current++,
        key,
        value: typeof value === "string" ? value : JSON.stringify(value),
      })),
    );
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
      const formData: Record<string, string> = {};
      for (const f of fields) {
        const k = f.key.trim();
        if (k) formData[k] = f.value;
      }
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
        name: name.trim() || "Unknown",
        email: email.trim() || "—",
        phone: phone.trim() || "—",
        formData,
      });
      setEditing(false);
      router.refresh();
      toast.success("Lead updated.");
    });

  const entries = Object.entries(lead.formData ?? {});

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
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
          />
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
            {fields.map((f) => (
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
            ))}
            <Button size="sm" variant="outline" className="h-8" onClick={addField}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add field
            </Button>
          </div>
        ) : entries.length > 0 ? (
          entries.map(([key, value]) => (
            <div key={key} className="space-y-0.5">
              <p className="text-xs capitalize text-muted-foreground">
                {key.replaceAll("_", " ")}
              </p>
              <p className="break-words font-medium">
                {typeof value === "string" ? value : JSON.stringify(value)}
              </p>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">No form responses.</p>
        )}
      </div>
    </div>
  );
}
