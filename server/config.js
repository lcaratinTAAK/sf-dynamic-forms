/**
 * Configuração lida do ambiente (.env carregado via `node --env-file=.env`).
 */

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
