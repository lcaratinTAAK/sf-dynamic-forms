/**
 * Configuração lida do ambiente (.env carregado via `node --env-file=.env`).
 */

import { TIPOS_SLA } from './sla.js';

const required = (name, value) => {
  if (!value) throw new Error(`Variável de ambiente obrigatória não definida: ${name}`);
  return value;
};

export const config = {
  apiVersion: process.env.SF_API_VERSION || '66.0',
  objectApiName: process.env.SF_OBJECT || 'Case',
  rulesObject: process.env.SF_RULES_OBJECT || 'FormFieldRule__c',
  formsObject: process.env.SF_FORMS_OBJECT || 'FormDefinition__c',
  documentsObject: process.env.SF_DOCS_OBJECT || 'FormRequiredDocument__c',
  docsField: process.env.SF_DOCS_FIELD || 'FormRequiredDocuments__c',
  port: Number(process.env.PORT || 3000),

  /**
   * SLA do caso gerado pelo envio.
   *
   * O envio cria o registro do formulário; uma automação cria o Case e grava o
   * Id do envio neste lookup; o processo de direito do Case cria os
   * CaseMilestone. `GET /api/sla` percorre esse caminho de volta.
   */
  slaSubmissionField: process.env.SF_SLA_SUBMISSION_FIELD || 'RelatedCaseFormSubmission__c',

  /**
   * Os tipos de milestone que contam como SLA. A lista vive em `sla.js`, que o
   * front também lê; `SF_SLA_MILESTONE_TYPES` substitui a lista inteira,
   * separada por `|` — vírgula não serve, um dos nomes tem vírgula.
   */
  slaMilestoneTypes: process.env.SF_SLA_MILESTONE_TYPES
    ? process.env.SF_SLA_MILESTONE_TYPES.split('|').map((s) => s.trim()).filter(Boolean)
    : TIPOS_SLA,

  /**
   * Campos que o Salesforce obriga a manter no Page Layout de Case mas que não
   * pertencem ao formulário. O Magic Link resolve isso do mesmo jeito hoje em
   * produção: uma lista de exclusão no BFF, porque a UI API não permite removê-los.
   */
  excludedFields: (process.env.SF_EXCLUDED_FIELDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  auth: {
    // MODO 2 tem precedência: se há token estático, usamos ele.
    staticToken: process.env.SF_ACCESS_TOKEN || null,
    staticInstanceUrl: process.env.SF_INSTANCE_URL || null,

    // MODO 1
    loginUrl: process.env.SF_LOGIN_URL || null,
    clientId: process.env.SF_CLIENT_ID || null,
    clientSecret: process.env.SF_CLIENT_SECRET || null,
  },
};

export function assertAuthConfigured() {
  const { staticToken, staticInstanceUrl, loginUrl, clientId, clientSecret } = config.auth;

  if (staticToken) {
    required('SF_INSTANCE_URL', staticInstanceUrl);
    return 'static-token';
  }

  required('SF_LOGIN_URL', loginUrl);
  required('SF_CLIENT_ID', clientId);
  required('SF_CLIENT_SECRET', clientSecret);
  return 'client-credentials';
}
