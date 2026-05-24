import { AdvancedDynamicTexture, Rectangle, TextBlock, Button, Control } from '@babylonjs/gui';

export interface ChampionOption {
    type: string;
    name: string;
    summary: string;
    startingPower?: string;
    color: string;
}

export class ChampionSelectOverlay {
    private ui: AdvancedDynamicTexture;
    private panel: Rectangle | null = null;

    constructor(ui: AdvancedDynamicTexture) {
        this.ui = ui;
    }

    public show(options: ChampionOption[], onPick: (type: string) => void): void {
        // Full-screen dark backdrop
        this.panel = new Rectangle('championSelectBg');
        this.panel.width = '100%';
        this.panel.height = '100%';
        this.panel.background = 'rgba(0,0,0,0.95)';
        this.panel.thickness = 0;
        this.panel.isPointerBlocker = true;
        this.ui.addControl(this.panel);

        // Title
        const title = new TextBlock('csTitle', 'CHOOSE YOUR CHAMPION');
        title.color = '#F5A623';
        title.fontSize = 36;
        title.fontWeight = 'bold';
        title.fontFamily = 'Arial';
        title.top = '-200px';
        title.height = '50px';
        this.panel.addControl(title);

        const subtitle = new TextBlock('csSubtitle', 'Your hero for this run');
        subtitle.color = '#888';
        subtitle.fontSize = 16;
        subtitle.fontFamily = 'Arial';
        subtitle.top = '-155px';
        subtitle.height = '24px';
        this.panel.addControl(subtitle);

        // Cards
        const total = options.length;
        options.forEach((opt, i) => {
            const card = new Rectangle(`csCard_${opt.type}`);
            card.width = '260px';
            card.height = '280px';
            card.background = '#1a1a2e';
            card.color = opt.color;
            card.thickness = 2;
            card.cornerRadius = 12;
            // Centre cards horizontally
            const offsetX = (i - (total - 1) / 2) * 290;
            card.left = `${offsetX}px`;
            card.isPointerBlocker = true;
            this.panel!.addControl(card);

            // Champion colour blob / icon area
            const iconArea = new Rectangle(`csIcon_${opt.type}`);
            iconArea.width = '80px';
            iconArea.height = '80px';
            iconArea.background = opt.color;
            iconArea.thickness = 0;
            iconArea.cornerRadius = 40;
            iconArea.top = '-70px';
            card.addControl(iconArea);

            const iconLetter = new TextBlock(`csIconLbl_${opt.type}`, opt.name[0]);
            iconLetter.color = '#fff';
            iconLetter.fontSize = 36;
            iconLetter.fontWeight = 'bold';
            iconArea.addControl(iconLetter);

            // Name
            const nameLabel = new TextBlock(`csName_${opt.type}`, opt.name);
            nameLabel.color = '#fff';
            nameLabel.fontSize = 20;
            nameLabel.fontWeight = 'bold';
            nameLabel.fontFamily = 'Arial';
            nameLabel.top = '25px';
            card.addControl(nameLabel);

            // Summary
            const summaryLabel = new TextBlock(`csSummary_${opt.type}`, opt.summary);
            summaryLabel.color = '#aaa';
            summaryLabel.fontSize = 13;
            summaryLabel.fontFamily = 'Arial';
            summaryLabel.textWrapping = true;
            summaryLabel.top = '75px';
            summaryLabel.paddingLeft = '14px';
            summaryLabel.paddingRight = '14px';
            card.addControl(summaryLabel);

            // Starting power line
            if (opt.startingPower) {
                const powerLabel = new TextBlock(`csPower_${opt.type}`, `Start: ${opt.startingPower}`);
                powerLabel.color = opt.color;
                powerLabel.fontSize = 13;
                powerLabel.fontFamily = 'Arial';
                powerLabel.top = '125px';
                card.addControl(powerLabel);
            }

            // "Select" button at card bottom
            const btn = Button.CreateSimpleButton(`csBtn_${opt.type}`, 'SELECT');
            btn.width = '200px';
            btn.height = '40px';
            btn.color = '#fff';
            btn.background = opt.color;
            btn.cornerRadius = 8;
            btn.thickness = 0;
            btn.fontFamily = 'Arial';
            btn.fontSize = 15;
            btn.fontWeight = 'bold';
            btn.top = '100px';
            btn.onPointerClickObservable.add(() => {
                this.close();
                onPick(opt.type);
            });
            card.addControl(btn);
        });
    }

    public close(): void {
        if (this.panel) {
            this.panel.dispose();
            this.panel = null;
        }
    }
}
