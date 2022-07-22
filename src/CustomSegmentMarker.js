import { Line } from 'konva/lib/shapes/Line';
import { Rect } from 'konva/lib/shapes/Rect';
import { Text } from 'konva/lib/shapes/Text';

const CustomSegmentMarker = class CustomSegmentMarker {
  constructor(options) {
    this._options = options;
  }

  init(group) {
    var handleWidth = 10;
    var handleHeight = 20;
    var handleX = -(handleWidth / 2) + 0.5; // Place in the middle of the marker

    var xPosition = this._options.startMarker ? -24 : 24;

    var time = this._options.startMarker ? this._options.segment.startTime :
      this._options.segment.endTime;

    // Label - create with default y, the real value is set in fitToView().
    this._label = new Text({
      x: xPosition,
      y: 0,
      text: this._options.layer.formatTime(time),
      fontFamily: this._options.fontFamily,
      fontSize: this._options.fontSize,
      fontStyle: this._options.fontStyle,
      fill: '#000',
      textAlign: 'center'
    });

    this._label.hide();

    // Handle - create with default y, the real value is set in fitToView().
    this._handle = new Rect({
      x: handleX,
      y: 0,
      width: handleWidth,
      height: handleHeight,
      fill: this._options.color,
      stroke: this._options.color,
      strokeWidth: 1
    });

    // Vertical Line - create with default y and points, the real values
    // are set in fitToView().
    this._line = new Line({
      x: 0,
      y: 0,
      stroke: this._options.color,
      strokeWidth: 1
    });

    group.add(this._label);
    group.add(this._line);
    group.add(this._handle);

    this.fitToView();

    this.bindEventHandlers(group);
  }

  bindEventHandlers(group) {
    var self = this;

    var xPosition = self._options.startMarker ? -24 : 24;

    if (self._options.draggable) {
      group.on('dragstart', function () {
        if (self._options.startMarker) {
          self._label.setX(xPosition - self._label.getWidth());
        }

        self._label.show();
      });

      group.on('dragend', function () {
        self._label.hide();
      });
    }

    self._handle.on('mouseover touchstart', function () {
      if (self._options.startMarker) {
        self._label.setX(xPosition - self._label.getWidth());
      }

      self._label.show();
    });

    self._handle.on('mouseout touchend', function () {
      self._label.hide();
    });
  }

  fitToView() {
    var height = this._options.layer.getHeight();

    this._label.y(height / 6 - 5);
    this._handle.y(height / 6 - 10.5);
    this._line.points([0.5, 0, 0.5, height]);
  }

  timeUpdated(time) {
    this._label.setText(this._options.layer.formatTime(time));
  }
}

const createSegmentMarker = function (options) {
  return new CustomSegmentMarker(options)
}

export default createSegmentMarker;
