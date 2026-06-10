import { NetClient } from './NetClient';
import { WebSocketTransport } from './WebSocketTransport';

/**
 * Minimal DOM panel to exercise the relay with two browser tabs. Mounted only
 * when `?coopdebug` is in the URL (see src/index.ts). Not part of the game.
 */
export function mountCoopDebug(): void {
    const panel = document.createElement('div');
    panel.style.cssText =
        'position:fixed;top:12px;left:12px;z-index:99999;background:#101018ee;color:#e8e8f0;' +
        'font:13px monospace;padding:12px;border:1px solid #444;border-radius:8px;width:260px';
    panel.innerHTML = `
        <div style="font-weight:bold;margin-bottom:8px">co-op relay debug</div>
        <button id="cd-host">Host</button>
        <input id="cd-code" placeholder="CODE" size="7" style="text-transform:uppercase"/>
        <button id="cd-join">Join</button>
        <button id="cd-ping" disabled>Ping</button>
        <pre id="cd-log" style="white-space:pre-wrap;margin:8px 0 0;max-height:160px;overflow:auto"></pre>`;
    document.body.appendChild(panel);

    const log = (s: string) => {
        const el = panel.querySelector('#cd-log') as HTMLPreElement;
        el.textContent = `${s}\n${el.textContent ?? ''}`;
    };
    let client: NetClient | null = null;

    const wire = (c: NetClient) => {
        client = c;
        (panel.querySelector('#cd-ping') as HTMLButtonElement).disabled = false;
        c.onPeerLeft = () => log('peer-left');
        log(`connected as ${c.role}`);
    };

    (panel.querySelector('#cd-host') as HTMLButtonElement).onclick = async () => {
        const res = await fetch('/room', { method: 'POST' });
        const { code } = await res.json();
        log(`room ${code} — share it`);
        (panel.querySelector('#cd-code') as HTMLInputElement).value = code;
        wire(new NetClient(await WebSocketTransport.connect(location.origin, code)));
    };

    (panel.querySelector('#cd-join') as HTMLButtonElement).onclick = async () => {
        const code = (panel.querySelector('#cd-code') as HTMLInputElement).value.trim().toUpperCase();
        if (code.length !== 6) return log('enter a 6-char code');
        wire(new NetClient(await WebSocketTransport.connect(location.origin, code)));
    };

    (panel.querySelector('#cd-ping') as HTMLButtonElement).onclick = () => {
        if (!client) return;
        client.sendPing();
        setTimeout(() => log(`rtt ${client!.lastRttMs.toFixed(1)} ms`), 120);
    };
}
