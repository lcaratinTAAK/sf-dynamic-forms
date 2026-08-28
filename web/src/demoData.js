/**
 * Dados fixos de teste para o formulário SI Demo — Alteração de Dados Bancários.
 *
 * Os valores das picklists são os API values do Salesforce (sem acento), não os
 * labels. Os dados pessoais são deliberadamente falsos.
 *
 * Só aparece quando o contrato tem o campo controlador `SI_RequesterType__c`,
 * ou seja, apenas neste formulário.
 */

const COMUM = {
  SI_ContractStatus__c: 'Ativo',
  SI_Email__c: 'teste.demo@exemplo.com.br',
  SI_FullName__c: 'Maria Teste da Silva',
  SI_OwnerDocument__c: '000.000.000-00',

  SI_AccountHolder__c: 'MesmaTitularidade',
  SI_BankType__c: 'BancoDigital',
  SI_BankBranch__c: '0001',
  SI_BankAccount__c: '123456-7',
  SI_DocumentType__c: 'CNH',
};

const ANEXOS = ['documento-frente.jpg', 'documento-verso.jpg', 'selfie-documento.jpg'];

export const CONTROLLER_FIELD = 'SI_RequesterType__c';

export const CENARIOS = [
  {
    id: 'proprietario',
    label: 'Preencher como Proprietário',
    values: {
      ...COMUM,
      SI_RequesterType__c: 'Proprietario',
      SI_PPMulti__c: 'Nao',
      SI_SameAccountAllContracts__c: 'Sim',
    },
    files: ANEXOS,
  },
  {
    id: 'parceiro',
    label: 'Preencher como Parceiro',
    values: {
      ...COMUM,
      SI_RequesterType__c: 'Parceiro',
      SI_PartnerRole__c: 'Corretor',
      SI_PartnerCPF__c: '111.111.111-11',
      SI_PartnerPhone__c: '(11) 90000-0000',
    },
    files: ANEXOS,
  },
];

/** O botão só faz sentido no formulário que tem o campo controlador. */
export function suportaDemo(contract) {
  return contract.sections.some((s) => s.fields.some((f) => f.apiName === CONTROLLER_FIELD));
}
