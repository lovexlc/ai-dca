import { AlertTriangle, HelpCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { subscribeToConfirmActions } from '../app/confirm.js';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from './ui/dialog.jsx';

export function GlobalConfirmDialog() {
  const [request, setRequest] = useState(null);
  const queueRef = useRef([]);

  useEffect(() => subscribeToConfirmActions((next) => {
    setRequest((current) => {
      if (current) {
        queueRef.current.push(next);
        return current;
      }
      return next;
    });
  }), []);

  function finish(result) {
    request?.resolve?.(result);
    setRequest(queueRef.current.shift() || null);
  }

  if (!request) return null;
  const danger = request.tone === 'danger';
  const Icon = danger ? AlertTriangle : HelpCircle;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) finish(false); }}>
      <DialogContent className="sm:max-w-md" showCloseButton={false} onEscapeKeyDown={() => finish(false)}>
        <DialogHeader className="text-left">
          <div className="flex items-start gap-3">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${danger ? 'bg-rose-50 text-rose-600' : 'bg-indigo-50 text-indigo-600'}`}>
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle>{request.title}</DialogTitle>
              {request.description ? <DialogDescription className="mt-2 leading-6">{request.description}</DialogDescription> : null}
            </div>
          </div>
        </DialogHeader>
        <DialogFooter className="mt-2">
          <button type="button" className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={() => finish(false)}>
            {request.cancelText}
          </button>
          <button autoFocus type="button" className={`inline-flex min-h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold text-white ${danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-indigo-600 hover:bg-indigo-700'}`} onClick={() => finish(true)}>
            {request.confirmText}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
