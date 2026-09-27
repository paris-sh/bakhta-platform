"use client";

import { useState } from "react";
import { useAdminAuth } from "@/lib/admin/auth-context";
import { useAdminI18n } from "@/lib/admin/i18n";
import { adminApi } from "@/lib/admin/api";
import type { AdminGame } from "@/lib/admin/types";
import { Field, Modal, inputSm } from "./ui";
import { ErrorMessage } from "@/components/StatusMessage";

/** Edits the game fields the existing PATCH /v1/admin/games/:id accepts. */
export function EditGameModal({ game, onClose, onSaved }: { game: AdminGame; onClose: () => void; onSaved: () => void }) {
  const { run } = useAdminAuth();
  const { a, errorText } = useAdminI18n();
  const [nameEn, setNameEn] = useState(game.nameEn);
  const [nameFa, setNameFa] = useState(game.nameFa);
  const [status, setStatus] = useState(game.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const changed: { nameEn?: string; nameFa?: string; status?: string } = {};
  if (nameEn.trim() !== game.nameEn) changed.nameEn = nameEn.trim();
  if (nameFa.trim() !== game.nameFa) changed.nameFa = nameFa.trim();
  if (status !== game.status) changed.status = status;
  const valid = nameEn.trim() !== "" && nameFa.trim() !== "" && Object.keys(changed).length > 0;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await run((token) => adminApi.updateGame(token, game.id, changed));
      onSaved();
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title={a.games.editTitle}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            {a.common.cancel}
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={!valid || saving} onClick={save}>
            {saving ? a.common.saving : a.common.save}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={a.games.nameEn} htmlFor="g-name-en">
          <input id="g-name-en" className={inputSm} lang="en" dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} data-autofocus />
        </Field>
        <Field label={a.games.nameFa} htmlFor="g-name-fa">
          <input id="g-name-fa" className={inputSm} lang="fa" dir="rtl" value={nameFa} onChange={(e) => setNameFa(e.target.value)} />
        </Field>
        <Field label={a.games.status} htmlFor="g-status" hint={a.games.statusHint}>
          <select id="g-status" className={inputSm} value={status} onChange={(e) => setStatus(e.target.value)}>
            {["ACTIVE", "PAUSED", "ARCHIVED"].map((s) => (
              <option key={s} value={s}>
                {a.status.game[s]}
              </option>
            ))}
          </select>
        </Field>
        {error !== null && <ErrorMessage message={errorText(error)} />}
      </div>
    </Modal>
  );
}
