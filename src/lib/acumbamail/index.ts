export {
  ACUMBAMAIL_API_URL,
  AcumbamailError,
  acumbamailResponseId,
  callAcumbamail,
  type AcumbamailResponse,
} from './client'

export {
  addSubscribers,
  configureListWebhook,
  createRecipientList,
  deleteList,
  getLists,
  getListStats,
  type AcumbamailMergeTagType,
  type AcumbamailSubscriber,
  type CreateRecipientListInput,
} from './lists'

export {
  createCampaign,
  fetchCampaignStats,
  getCampaigns,
  type CreateCampaignInput,
} from './campaigns'
