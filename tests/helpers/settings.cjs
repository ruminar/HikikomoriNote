"use strict";
module.exports = function settings(tags = []) {
  return { enabled: true, noteUserId: "", dashboardDisabled: false, legacyMode: false,
    hideArticleRecommendations: false, confirmNoteLogoClick: false, tagSchemaVersion: 2,
    tagGroups: [1, 2, 3, 4].map(number => ({ id: `group${number}`, name: "", tags: number === 1 ? tags : [] })),
    selectedTagGroupId: "group1", groupSelectionRevision: 0, tagGroupsRevision: 0 };
};
module.exports.groups = function groups(tags = []) {
  const {tagSchemaVersion,tagGroups,selectedTagGroupId,groupSelectionRevision,tagGroupsRevision}=module.exports(tags);
  return {tagSchemaVersion,tagGroups,selectedTagGroupId,groupSelectionRevision,tagGroupsRevision};
};
