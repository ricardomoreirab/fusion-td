import { AdvancedDynamicTexture, Rectangle, TextBlock, Button, Control } from '@babylonjs/gui';
import { PowerSlot } from '../gameplay/PowerSlotManager';

export class ReplaceSlotOverlay {
    private ui: AdvancedDynamicTexture;
    private panel: Rectangle | null = null;

    constructor(ui: AdvancedDynamicTexture) {
        this.ui = ui;
    }

    public show(
        currentSlots: (PowerSlot | null)[],
        newPowerName: string,
        onPick: (slotIndex: number) => void,
        onCancel: () => void,
    ): void {
        this.panel = new Rectangle('replaceSlotBg');
        this.panel.width = '100%';
        this.panel.height = '100%';
        this.panel.background = 'rgba(0,0,0,0.75)';
        this.panel.thickness = 0;
        this.ui.addControl(this.panel);

        const title = new TextBlock('replaceTitle', `Replace which power with ${newPowerName}?`);
        title.color = '#fff';
        title.fontSize = 22;
        title.top = '-180px';
        title.textWrapping = true;
        title.width = '700px';
        this.panel.addControl(title);

        currentSlots.forEach((slot, i) => {
            if (!slot) return;
            const label = `${slot.def.name} Lv ${slot.state.level}`;
            const btn = Button.CreateSimpleButton(`replaceSlot${i}`, label);
            btn.width = '170px';
            btn.height = '100px';
            btn.color = '#fff';
            btn.background = '#444';
            btn.cornerRadius = 8;
            btn.thickness = 2;
            const totalNonNull = currentSlots.filter(s => s !== null).length;
            const visualIndex = currentSlots.slice(0, i + 1).filter(s => s !== null).length - 1;
            btn.left = `${(visualIndex - (totalNonNull - 1) / 2) * 185}px`;
            btn.onPointerClickObservable.add(() => {
                onPick(i);
                this.close();
            });
            this.panel!.addControl(btn);
        });

        const cancelBtn = Button.CreateSimpleButton('replaceCancel', 'Cancel (+25 gold)');
        cancelBtn.width = '180px';
        cancelBtn.height = '44px';
        cancelBtn.color = '#ddd';
        cancelBtn.background = '#333';
        cancelBtn.cornerRadius = 8;
        cancelBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        cancelBtn.top = '-40px';
        cancelBtn.onPointerClickObservable.add(() => {
            onCancel();
            this.close();
        });
        this.panel.addControl(cancelBtn);
    }

    public close(): void {
        if (this.panel) {
            this.panel.dispose();
            this.panel = null;
        }
    }

    public isOpen(): boolean {
        return this.panel !== null;
    }
}
