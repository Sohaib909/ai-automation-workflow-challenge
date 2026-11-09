import type { QCFlag } from "@/lib/qc";
import { ActionForm, type FormAction, GeneratingPanel, Submit } from "./action-form";
import { QCList } from "./ui";

/**
 * The one review control used on every AI result: Approve · Regenerate · Reject.
 * Regenerate opens a small optional "what should change?" box.
 */
export function ReviewBar({
  decide,
  regenerate,
  idName,
  id,
  status,
  blocked,
  what = "Regenerating",
}: {
  decide: FormAction;
  regenerate?: FormAction;
  idName: string;
  id: number;
  status: string;
  blocked?: boolean;
  what?: string;
}) {
  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="flex flex-wrap items-start gap-2">
        <ActionForm action={decide} className="flex flex-wrap gap-2">
          <input type="hidden" name={idName} value={id} />
          <input type="hidden" name="comment" value="" />
          {status !== "approved" && (
            <Submit name="decision" value="approve" pending="Approving…">
              ✓ Approve
            </Submit>
          )}
          {status !== "rejected" && (
            <Submit name="decision" value="reject" variant="danger" pending="Rejecting…">
              Reject
            </Submit>
          )}
        </ActionForm>
        {regenerate && (
          <details className="group">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
              ↻ Regenerate
            </summary>
            <ActionForm action={regenerate} className="mt-2 flex w-full min-w-72 flex-wrap items-end gap-2">
              <input type="hidden" name={idName} value={id} />
              <input name="instruction" placeholder="What should change? (optional)" className="min-w-56 flex-1" aria-label="What should change" />
              <Submit pending="Regenerating…" variant="secondary">
                Regenerate
              </Submit>
              <GeneratingPanel what={what} />
            </ActionForm>
          </details>
        )}
      </div>
      {blocked && status !== "approved" && <p className="mt-2 text-xs text-bad">Fix the issue marked ✕ (regenerate or edit) before approving.</p>}
    </div>
  );
}

/** One line for the checks; details on demand. */
export function QCSummary({ flags }: { flags: QCFlag[] }) {
  const shown = flags.filter((f) => f.code !== "mock");
  const errors = shown.filter((f) => f.level === "error").length;
  const warnings = shown.filter((f) => f.level === "warning").length;
  const mock = flags.some((f) => f.code === "mock");
  const summary =
    errors > 0 ? (
      <span className="text-bad">✕ {errors} problem{errors > 1 ? "s" : ""} to fix{warnings ? ` · ${warnings} to check` : ""}</span>
    ) : warnings > 0 ? (
      <span className="text-warn">! {warnings} thing{warnings > 1 ? "s" : ""} to check</span>
    ) : (
      <span className="text-good">✓ All checks passed</span>
    );
  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer">
        {summary}
        {mock && <span className="ml-2 text-xs text-warn">(mock provider — template output)</span>}
        <span className="ml-2 text-xs text-muted">details</span>
      </summary>
      <div className="mt-2">
        <QCList flags={shown} />
      </div>
    </details>
  );
}
