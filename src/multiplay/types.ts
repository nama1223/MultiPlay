export interface MpMarker {
  time: number
  label: string
}

export interface MpTrack {
  id: string
  name: string
  url: string
  offsetMs?: number
  gain?: number
}

export interface MpSongManifest {
  id: string
  title: string
  groupId: string
  groupName?: string
  tracks: MpTrack[]
  markers: MpMarker[]
}

export interface MpSongSummary {
  id: string
  title: string
  trackCount?: number
}

export interface MpGroup {
  id: string
  name: string
  songs: MpSongSummary[]
}

export interface MpIndex {
  groups: MpGroup[]
}
