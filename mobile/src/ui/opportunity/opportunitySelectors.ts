/** UI selector facade：页面只从这里取 card view-model，不直接解释 Snapshot machine fields。 */
export {
  selectOpportunityCard,
  selectOpportunityCards,
  toOpportunityCardViewModel,
  type OpportunityCardViewModel,
  type OpportunitySelectorOptions,
} from './opportunityViewModel';

