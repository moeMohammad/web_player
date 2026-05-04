const assert = require('node:assert/strict');
const test = require('node:test');

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.className = '';
    this._innerHTML = '';
    this.textContent = '';
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children = children;
    this._innerHTML = '';
  }

  set innerHTML(value) {
    this._innerHTML = value;
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }
}

function flattenText(node) {
  if (!node) return '';
  if (node.nodeType === 3) return node.textContent;
  return (node.children || []).map(flattenText).join('');
}

global.document = {
  createElement(tagName) {
    return new FakeElement(tagName);
  },
  createTextNode(text) {
    return { nodeType: 3, textContent: text };
  },
};

global.setInterval = () => 1;
global.clearInterval = () => {};

const SubtitleRenderer = require('../js/subtitle-renderer.js');

test('finds active cues with indexed lookup instead of scanning every cue', () => {
  const cues = [
    { startTime: 1, endTime: 2, text: 'one' },
    { startTime: 4, endTime: 6, text: 'two' },
    { startTime: 8, endTime: 9, text: 'three' },
  ];

  assert.equal(SubtitleRenderer.getActiveCueText(cues, 4.5), 'two');
  assert.equal(SubtitleRenderer.getActiveCueText(cues, 7), '');
});

test('renders decoded subtitle text without treating it as HTML', () => {
  const overlay = new FakeElement();
  SubtitleRenderer.init({ currentTime: 0, addEventListener() {} }, overlay);

  SubtitleRenderer.displaySubtitle('&lt;b&gt;not bold&lt;/b&gt;\nplain');

  assert.equal(overlay.children.length, 1);
  assert.equal(overlay.innerHTML, '');
  assert.equal(flattenText(overlay.children[0]), '<b>not bold</b>plain');
});
