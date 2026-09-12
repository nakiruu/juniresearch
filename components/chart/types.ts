export type Tone = "bull" | "accent" | "secondary" | "bear";
export type ChartLayout = "wide" | "narrow";

export interface ChartTarget {
  key: string;
  name: string;
  value: number;
  tone: Tone;
}

export interface ChartModel {
  company: string;
  exchange: string;
  ticker: string;
  asOf: string;
  current: number;
  bandLo: number;
  bandHi: number;
  bandPctText: string;
  targets: ChartTarget[];
}

export interface ChartDims {
  width: number;
  height: number;
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
  /** x of the right-margin label column; null when the layout has none. */
  labelX: number | null;
}

export interface ChartScales {
  x: (day: number) => number;
  y: (price: number) => number;
  gridValues: number[];
  nowX: number;
  curY: number;
  yMin: number;
  yMax: number;
}

export interface LabelRow {
  key: string;
  name: string;
  value: string;
  tone: Tone;
  /** y of the true price on the axis — where the leader line starts. */
  anchorY: number;
  /** y the label is drawn at after decluttering. */
  labelY: number;
}

export interface BandBox {
  top: number;
  bottom: number;
  midY: number;
  captionX: number;
}

export interface HistoryPoint { day: number; price: number }

export interface HistorySeries {
  points: HistoryPoint[];
  /** True while the series is synthetic. Surfaced as a caption in the report. */
  placeholder: boolean;
}
