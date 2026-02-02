export class LayersPanel {
	constructor(container, layerManager, options = {}) {
		this.container = container;
		this.layerManager = layerManager;
		this.onToggle = typeof options.onToggle === 'function' ? options.onToggle : null;
		this.collapsed = false;
	}

	init() {
		const saved = localStorage.getItem('layersPanelCollapsed');
		if (saved === 'true') this.collapsed = true;
		this.render();
	}

	render() {
		this.container.innerHTML = '';

		const header = document.createElement('div');
		header.className = 'layers-header';

		const title = document.createElement('div');
		title.className = 'layers-title';
		title.textContent = 'Layers';

		const toggle = document.createElement('button');
		toggle.type = 'button';
		toggle.className = 'layers-toggle';
		const applyToggleState = () => {
			toggle.textContent = this.collapsed ? '▸' : '▾';
			toggle.title = this.collapsed ? 'Expand layers' : 'Collapse layers';
			list.style.display = this.collapsed ? 'none' : 'flex';
		};
		toggle.addEventListener('click', () => {
			this.collapsed = !this.collapsed;
			localStorage.setItem('layersPanelCollapsed', this.collapsed ? 'true' : 'false');
			applyToggleState();
		});

		header.appendChild(title);
		header.appendChild(toggle);
		this.container.appendChild(header);

		const list = document.createElement('div');
		list.className = 'layers-list';

		const layers = this.layerManager.list();
		layers.forEach((layer) => {
			const item = document.createElement('div');
			item.className = 'layer-item';

			const label = document.createElement('label');
			label.className = 'layer-label';

			const toggle = document.createElement('input');
			toggle.type = 'checkbox';
			toggle.checked = this.layerManager.isEnabled(layer.id);
			toggle.addEventListener('change', () => {
				this.layerManager.toggleLayer(layer.id, toggle.checked);
					if (this.onToggle) this.onToggle(layer.id, toggle.checked);
			});

			const name = document.createElement('span');
			name.textContent = layer.name;

			const refresh = document.createElement('button');
			refresh.type = 'button';
			refresh.textContent = '⟳';
			refresh.title = 'Refresh layer';
			refresh.addEventListener('click', () => {
				this.layerManager.refreshLayer(layer.id);
			});

			label.appendChild(toggle);
			label.appendChild(name);
			item.appendChild(label);
			item.appendChild(refresh);

			list.appendChild(item);
		});

		this.container.appendChild(list);
			applyToggleState();
	}
}
