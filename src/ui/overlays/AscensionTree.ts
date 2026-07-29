import { makeModal, ModalController } from '../primitives/Modal';
import { makeFrame } from '../primitives/Frame';
import { makeIconSlot } from '../primitives/IconSlot';
import { makeButton, setButtonLabel } from '../primitives/Button';
import { el } from '../dom';
import { onTap } from '../interaction';
import { iconEl, IconName } from '../icons';
import { TREE_W, TREE_H, nodeXY } from '../../survivors/ascension/AscensionTrees';
import { t } from '../../i18n';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface AscNodeVM {
    id: string;
    name: string;
    icon: IconName;
    tier: number;
    col: number;
    points: number;
    max: number;
    /** Effect text at the CURRENT rank (rank 1 preview when unspent). */
    descNow: string;
    /** Effect text at the next rank — what the next point actually buys. */
    descNext: string | null;
    canSpend: boolean;
    /** Why not, when canSpend is false. */
    blockedReason: string | null;
    /** The path's tier gate is not yet met. */
    locked: boolean;
    riderText: string | null;
    riderActive: boolean;
}

export interface AscPathVM {
    id: string;
    name: string;
    /** A tokens.css custom-property name, e.g. '--el-storm'. Never a raw hex. */
    accent: string;
    icon: IconName;
    tagline: string;
    points: number;
    capstoneName: string;
    capstoneNeed: number;
    nodes: AscNodeVM[];
}

export interface AscensionVM {
    level: number;
    maxLevel: number;
    progress: number;
    unspent: number;
    paths: AscPathVM[];
}

/**
 * The Ascension tree overlay. A dumb renderer — the gameplay state owns the
 * AscensionSystem, builds the VM and re-supplies it after every spend.
 *
 * Interaction: clicking a node opens a detail POPUP, and the point is committed
 * from a button inside that popup. Two presses, not one, and deliberately so:
 * onTap fires on a bare pointerup with no movement threshold or pointerdown
 * pairing, so a single-press spend would fire every time the player dragged the
 * canvas to scroll and released over a node. An accidental popup is harmless.
 *
 * Two layout facts that bite:
 *  1. The PANEL never scrolls; `.asc-scroll` does. `.modal-panel`'s own
 *     `max-height: 92vh; overflow: auto` would otherwise scroll the points
 *     counter out of view exactly when it matters.
 *  2. The popup is mounted on the OVERLAY LAYER as a sibling of the tree modal,
 *     never inside it: `.frame--ornate` carries `clip-path: var(--chamfer-lg)`,
 *     which clips every descendant, so a nested popup would be sliced off at the
 *     panel edge. (Same reason CharacterProfile has no floating tooltip.)
 *  3. Edges and nodes read the SAME authored coordinates (nodeXY), so the lines
 *     can never drift away from the sockets on resize.
 */
export class AscensionTreeOverlay {
    private modal: ModalController | null = null;
    private headerPoints: HTMLElement | null = null;
    private headerLevel: HTMLElement | null = null;
    private onSpend: ((nodeId: string) => void) | null = null;
    private vm: AscensionVM | null = null;
    /** The node-detail popup, mounted on the overlay layer above the tree. */
    private popupRoot: HTMLDivElement | null = null;
    private popupBody: HTMLDivElement | null = null;
    private popupSpend: HTMLElement | null = null;
    private popupNodeId: string | null = null;

    constructor(private parent: HTMLElement) {}

    public show(vm: AscensionVM, onSpend: (nodeId: string) => void): void {
        this.closeSilently();
        this.onSpend = onSpend;
        this.vm = vm;

        const modal = makeModal({ title: t('ascension.title'), panelClass: 'modal-panel--ascension' });

        const closeBtn = el('div', {
            class: 'modal-close interactive',
            attrs: { role: 'button', 'aria-label': 'Close' },
        }, [iconEl('close')]);
        onTap(closeBtn, () => this.close());
        modal.panel.appendChild(closeBtn);
        modal.root.addEventListener('click', (e) => { if (e.target === modal.root) this.close(); });

        // ── Pinned header: unspent points + ascension level ──
        this.headerPoints = el('div', { class: 'asc-header__points' });
        this.headerLevel = el('div', { class: 'asc-header__level' });
        const header = el('div', { class: 'asc-header' }, [
            el('div', { class: 'asc-header__badge' }, [iconEl('rune'), this.headerPoints]),
            el('div', { class: 'asc-header__hint', text: t('ascension.selectNode') }),
            this.headerLevel,
        ]);

        // ── Scroller → canvas → (edges + columns) ──
        const canvas = el('div', { class: 'asc-canvas' });
        canvas.style.setProperty('--tree-w', `${TREE_W}px`);
        canvas.style.setProperty('--tree-h', `${TREE_H}px`);
        canvas.appendChild(this.buildEdges(vm));
        vm.paths.forEach((p, pi) => canvas.appendChild(this.buildColumn(p, pi)));
        const scroll = el('div', { class: 'asc-scroll' }, [canvas]);

        modal.body.append(header, scroll);
        this.parent.appendChild(modal.root);
        this.modal = modal;

        this.renderChrome(vm);
    }

    /** Re-render against fresh state after a spend. Keeps scroll + open popup. */
    public refresh(vm: AscensionVM): void {
        if (!this.modal) return;
        this.vm = vm;
        const canvas = this.modal.body.querySelector('.asc-canvas') as HTMLElement | null;
        if (canvas) {
            const scrollEl = this.modal.body.querySelector('.asc-scroll') as HTMLElement | null;
            const sx = scrollEl ? scrollEl.scrollLeft : 0;
            const sy = scrollEl ? scrollEl.scrollTop : 0;
            canvas.replaceChildren();
            canvas.appendChild(this.buildEdges(vm));
            vm.paths.forEach((p, pi) => canvas.appendChild(this.buildColumn(p, pi)));
            if (scrollEl) { scrollEl.scrollLeft = sx; scrollEl.scrollTop = sy; }
        }
        this.renderChrome(vm);
        // Keep the popup on the same node so three points can be spent in a row.
        if (this.popupNodeId) this.renderPopup();
    }

    private renderChrome(vm: AscensionVM): void {
        if (this.headerPoints) {
            this.headerPoints.textContent = vm.unspent === 1 ? '1 point' : `${vm.unspent} points`;
        }
        if (this.headerLevel) {
            this.headerLevel.textContent = `Ascension ${vm.level} / ${vm.maxLevel}`;
        }
    }

    /**
     * Orthogonal tier-to-tier edges routed through a mid-Y rail. They are drawn
     * tier-to-tier rather than node-to-node because that is exactly what the
     * gates enforce: there are no per-node prerequisites, only points in path.
     */
    private buildEdges(vm: AscensionVM): SVGSVGElement {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', 'asc-edges');
        svg.setAttribute('viewBox', `0 0 ${TREE_W} ${TREE_H}`);
        svg.setAttribute('preserveAspectRatio', 'none');

        vm.paths.forEach((p, pi) => {
            const accent = `var(${p.accent})`;
            for (let tier = 1; tier < 5; tier++) {
                const from = p.nodes.filter((n) => n.tier === tier);
                const to = p.nodes.filter((n) => n.tier === tier + 1);
                if (!from.length || !to.length) continue;
                // The NEXT tier being unlocked is what lights this gap.
                const live = to.some((n) => !n.locked);
                for (const a of from) {
                    for (const b of to) {
                        const pa = nodeXY(pi, a);
                        const pb = nodeXY(pi, b);
                        const mid = (pa.y + pb.y) / 2;
                        const line = document.createElementNS(SVG_NS, 'path');
                        line.setAttribute('d',
                            `M ${pa.x} ${pa.y} L ${pa.x} ${mid} L ${pb.x} ${mid} L ${pb.x} ${pb.y}`);
                        line.setAttribute('class', `asc-edge${live ? ' asc-edge--live' : ' asc-edge--locked'}`);
                        line.setAttribute('vector-effect', 'non-scaling-stroke');
                        if (live) line.style.setProperty('--accent', accent);
                        svg.appendChild(line);
                    }
                }
            }
        });
        return svg;
    }

    private buildColumn(p: AscPathVM, pathIndex: number): HTMLDivElement {
        const col = el('div', { class: 'asc-col' });
        col.style.setProperty('--accent', `var(${p.accent})`);

        // Column header: identity + investment + capstone gate progress. Gate
        // progress is rendered from the FIRST point spent, so the player can see
        // how far a capstone is while the choice still matters.
        const gateText = p.points >= p.capstoneNeed
            ? `${p.capstoneName} unlocked`
            : `${p.capstoneNeed - p.points} points from ${p.capstoneName}`;
        const head = el('div', { class: 'asc-col__head' }, [
            el('div', { class: 'asc-col__title' }, [
                iconEl(p.icon),
                el('span', { text: p.name }),
                el('span', { class: 'asc-col__count', text: `${p.points} / 27` }),
            ]),
            el('div', { class: 'asc-col__tagline', text: p.tagline }),
            el('div', {
                class: `asc-col__gate${p.points >= p.capstoneNeed ? ' asc-col__gate--on' : ''}`,
                text: gateText,
            }),
        ]);
        head.style.left = `${(TREE_W / 3) * pathIndex}px`;
        head.style.width = `${TREE_W / 3}px`;
        col.appendChild(head);

        for (const n of p.nodes) col.appendChild(this.buildNode(n, p, pathIndex));
        return col;
    }

    private buildNode(n: AscNodeVM, p: AscPathVM, pathIndex: number): HTMLDivElement {
        const { x, y } = nodeXY(pathIndex, n);
        const wrap = el('div', {
            class: 'asc-node'
                + (n.locked ? ' asc-node--locked' : '')
                + (n.points > 0 ? ' asc-node--owned' : '')
                + (n.points >= n.max ? ' asc-node--maxed' : '')
                + (n.canSpend ? ' asc-node--ready' : '')
                + (n.tier === 5 ? ' asc-node--capstone' : '')
                + (n.id === this.popupNodeId ? ' asc-node--selected' : ''),
            attrs: { role: 'button', 'aria-label': `${n.name}, ${n.points} of ${n.max} points` },
        });
        wrap.style.left = `${x}px`;
        wrap.style.top = `${y}px`;

        const socket = makeIconSlot('asc-node__socket');
        socket.setIcon(n.icon, n.points > 0 ? `var(${p.accent})` : 'var(--c-parchment-faint)');
        socket.setAccent(`var(${p.accent})`);
        socket.setEmpty(n.points === 0);

        // Points render as 3 pips, not the slot's ×N badge — the pips show the
        // ceiling as well as the current rank at a glance.
        const pips = el('div', { class: 'asc-pips' });
        for (let i = 0; i < n.max; i++) {
            pips.appendChild(el('div', { class: `asc-pip${i < n.points ? ' asc-pip--on' : ''}` }));
        }

        wrap.append(socket.root, el('div', { class: 'asc-node__name', text: n.name }), pips);
        onTap(wrap, () => this.openPopup(n.id));
        return wrap;
    }

    private findNode(nodeId: string | null): { node: AscNodeVM; path: AscPathVM } | null {
        if (!nodeId || !this.vm) return null;
        for (const p of this.vm.paths) {
            for (const n of p.nodes) if (n.id === nodeId) return { node: n, path: p };
        }
        return null;
    }

    // ── Node detail popup ───────────────────────────────────────────────────

    public isPopupOpen(): boolean { return this.popupRoot !== null; }

    /** Open (or retarget) the node popup. Mounted on the overlay layer as a
     *  SIBLING of the tree modal — nesting it would be clipped by the panel's
     *  chamfer clip-path. */
    private openPopup(nodeId: string): void {
        this.popupNodeId = nodeId;
        if (!this.popupRoot) {
            const root = el('div', { class: 'asc-popup-scrim interactive' });
            const panel = makeFrame({ variant: 'ornate', class: 'asc-popup' });
            const body = el('div', { class: 'asc-popup__body' });
            const closeBtn = el('div', {
                class: 'modal-close interactive',
                attrs: { role: 'button', 'aria-label': 'Close' },
            }, [iconEl('close')]);
            onTap(closeBtn, () => this.closePopup());
            this.popupSpend = makeButton({
                label: 'Spend a point', variant: 'forged', icon: 'chevronUp', class: 'asc-popup__spend',
                onClick: () => {
                    if (this.popupNodeId && this.onSpend) this.onSpend(this.popupNodeId);
                },
            });
            panel.append(closeBtn, body, this.popupSpend);
            root.appendChild(panel);
            root.addEventListener('click', (e) => { if (e.target === root) this.closePopup(); });
            this.parent.appendChild(root);
            this.popupRoot = root;
            this.popupBody = body;
        }
        this.renderPopup();
        this.markSelected();
    }

    public closePopup(): void {
        this.popupRoot?.remove();
        this.popupRoot = null;
        this.popupBody = null;
        this.popupSpend = null;
        this.popupNodeId = null;
        this.markSelected();
    }

    /** Keep the tree's selected-node ring in sync with the popup. */
    private markSelected(): void {
        const canvas = this.modal?.body.querySelector('.asc-canvas');
        if (!canvas) return;
        canvas.querySelectorAll('.asc-node--selected').forEach((e) => e.classList.remove('asc-node--selected'));
        if (!this.popupNodeId || !this.vm) return;
        let i = 0;
        for (const p of this.vm.paths) {
            for (const n of p.nodes) {
                if (n.id === this.popupNodeId) {
                    canvas.querySelectorAll('.asc-node')[i]?.classList.add('asc-node--selected');
                    return;
                }
                i++;
            }
        }
    }

    private renderPopup(): void {
        const body = this.popupBody;
        const found = this.findNode(this.popupNodeId);
        if (!body || !found) return;
        const { node, path } = found;

        this.popupRoot?.style.setProperty('--accent', `var(${path.accent})`);
        body.replaceChildren();

        const pips = el('div', { class: 'asc-pips asc-popup__pips' });
        for (let i = 0; i < node.max; i++) {
            pips.appendChild(el('div', { class: `asc-pip${i < node.points ? ' asc-pip--on' : ''}` }));
        }

        body.append(
            el('div', { class: 'asc-popup__path', text: `${path.name} · Tier ${node.tier}` }),
            el('div', { class: 'asc-popup__title' }, [
                iconEl(node.icon),
                el('span', { text: node.name }),
            ]),
            el('div', { class: 'asc-popup__rankrow' }, [
                pips,
                el('span', { class: 'asc-popup__rank', text: `${node.points} / ${node.max}` }),
            ]),
            el('div', { class: 'asc-popup__now' }, [
                el('span', { class: 'asc-popup__tag', text: node.points > 0 ? 'Now' : 'First point' }),
                el('span', { text: node.descNow }),
            ]),
        );

        // Show exactly what the NEXT point buys, before it is bought.
        if (node.descNext) {
            body.appendChild(el('div', { class: 'asc-popup__next' }, [
                el('span', { class: 'asc-popup__tag asc-popup__tag--next', text: t('ascension.nextPoint') }),
                el('span', { text: node.descNext }),
            ]));
        }

        if (node.riderText) {
            body.appendChild(el('div', {
                class: `asc-popup__rider${node.riderActive ? ' asc-popup__rider--on' : ''}`,
                text: (node.riderActive ? 'Linked — active: ' : 'Linked — inactive: ') + node.riderText,
            }));
        }

        if (node.points >= node.max) this.setSpendState(false, 'Fully invested');
        else if (node.canSpend) this.setSpendState(true, 'Spend a point');
        else this.setSpendState(false, node.blockedReason ?? 'Locked');
    }

    private setSpendState(enabled: boolean, label: string): void {
        const btn = this.popupSpend;
        if (!btn) return;
        setButtonLabel(btn, label);
        btn.classList.toggle('btn--disabled', !enabled);
        if (enabled) btn.removeAttribute('aria-disabled');
        else btn.setAttribute('aria-disabled', 'true');
    }

    private closeSilently(): void {
        this.closePopup();
        this.modal?.dispose();
        this.modal = null;
        this.headerPoints = null;
        this.headerLevel = null;
        this.vm = null;
        this.onSpend = null;
    }

    public close(): void { this.closeSilently(); }
    public isOpen(): boolean { return this.modal !== null; }
}
