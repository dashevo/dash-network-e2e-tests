const DashPlatformProtocol = require('@dashevo/dpp');
const getDataContractFixture = require('@dashevo/dpp/lib/test/fixtures/getDataContractFixture');

const {
  PublicKey,
} = require('@dashevo/dashcore-lib');

const waitForBlocks = require('../../../lib/waitForBlocks');

const createOutPointTxFactory = require('../../../lib/test/createOutPointTxFactory');
const getClientWithFundedWallet = require('../../../lib/test/getClientWithFundedWallet');
const wait = require('../../../lib/wait');

describe('Platform', function platform() {
  this.timeout(950000);

  let dpp;
  let client;
  let walletAccount;
  let identityCreateTransition;
  let identity;
  let identityRawPublicKey;
  let walletPublicKey;
  let walletPrivateKey;
  let createOutPointTx;

  before(async () => {
    dpp = new DashPlatformProtocol();

    client = await getClientWithFundedWallet();
    walletAccount = await client.getWalletAccount();
    ({
      publicKey: walletPublicKey,
      privateKey: walletPrivateKey,
    } = walletAccount.getIdentityHDKeyByIndex(0, 0));

    createOutPointTx = createOutPointTxFactory(client.getDAPIClient());
  });

  after(async () => {
    if (client) {
      await client.disconnect();
    }
  });

  describe('Identity', () => {
    it('should fail to create an identity if outpoint was not found', async () => {
      identity = dpp.identity.create(
        Buffer.alloc(36),
        [walletPublicKey],
      );

      identityCreateTransition = dpp.identity.createIdentityCreateTransition(identity);
      identityCreateTransition.signByPrivateKey(
        walletPrivateKey,
      );

      try {
        await client.getDAPIClient().applyStateTransition(
          identityCreateTransition,
        );
        expect.fail('Error was not thrown');
      } catch (e) {
        const [error] = JSON.parse(e.metadata.get('errors'));
        expect(error.name).to.equal('IdentityAssetLockTransactionNotFoundError');
      }
    });

    it('should create an identity', async () => {
      identity = await client.platform.identities.register(1);
      identityRawPublicKey = new PublicKey(
        Buffer.from(identity.getPublicKeys()[0].getData(), 'base64'),
      );

      // wait for change to come back
      while (walletAccount.getTotalBalance() === 0) {
        await wait(500);
      }
    });

    it('should fail to create an identity with the same first public key', async () => {
      const {
        transaction,
        privateKey,
      } = await createOutPointTx(
        1,
        walletAccount,
        walletPublicKey,
        walletPrivateKey,
      );

      const outPoint = transaction.getOutPointBuffer(0);

      await client.getDAPIClient().sendTransaction(transaction.toBuffer());
      await waitForBlocks(client.getDAPIClient(), 1);

      const otherIdentity = dpp.identity.create(
        outPoint,
        [walletPublicKey],
      );

      const otherIdentityCreateTransition = dpp.identity.createIdentityCreateTransition(
        otherIdentity,
      );
      otherIdentityCreateTransition.signByPrivateKey(
        privateKey,
      );

      try {
        await client.getDAPIClient().applyStateTransition(
          otherIdentityCreateTransition,
        );

        expect.fail('Error was not thrown');
      } catch (e) {
        const [error] = JSON.parse(e.metadata.get('errors'));
        expect(error.name).to.equal('IdentityFirstPublicKeyAlreadyExistsError');
        expect(error.publicKeyHash).to.equal(identity.getPublicKeyById(0).hash());
      }
    });

    it('should be able to get newly created identity', async () => {
      const fetchedIdentity = await client.platform.identities.get(
        identity.getId(),
      );

      expect(fetchedIdentity).to.be.not.null();
      expect(fetchedIdentity.toJSON()).to.deep.equal({
        ...identity.toJSON(),
        balance: 826,
      });

      // updating balance
      identity.setBalance(fetchedIdentity.getBalance());
    });

    it('should be able to get newly created identity by it\'s first public key', async () => {
      const serializedIdentity = await client.getDAPIClient().getIdentityByFirstPublicKey(
        identity.getPublicKeyById(0).hash(),
      );

      expect(serializedIdentity).to.be.not.null();

      const receivedIdentity = dpp.identity.createFromSerialized(
        serializedIdentity,
        { skipValidation: true },
      );

      expect(receivedIdentity.toJSON()).to.deep.equal({
        ...identity.toJSON(),
        balance: 826,
      });
    });

    it('should be able to get newly created identity id by it\'s first public key', async () => {
      const identityId = await client.getDAPIClient().getIdentityIdByFirstPublicKey(
        identity.getPublicKeyById(0).hash(),
      );

      expect(identityId).to.be.not.null();
      expect(identityId).to.equal(identity.getId());
    });

    describe('Credits', () => {
      let dataContractFixture;

      before(async () => {
        dataContractFixture = getDataContractFixture(identity.getId());

        await client.platform.contracts.broadcast(dataContractFixture, identity);

        client.apps.customContracts = {
          contractId: dataContractFixture.getId(),
          contract: dataContractFixture,
        };
      });

      it('should fail to create more documents if there are no more credits', async () => {
        const document = await client.platform.documents.create(
          'customContracts.niceDocument',
          identity,
          {
            name: 'Some Very Long Long Long Name',
          },
        );

        try {
          await client.platform.documents.broadcast({
            create: [document],
          }, identity);

          expect.fail('Error was not thrown');
        } catch (e) {
          expect(e.details).to.equal('Failed precondition: Not enough credits');
        }
      });

      it('should fail top-up if transaction has not been sent', async () => {
        const {
          transaction,
          privateKey,
        } = await createOutPointTx(
          1,
          walletAccount,
          identityRawPublicKey,
          walletPrivateKey,
        );

        const outPoint = transaction.getOutPointBuffer(0);

        const identityTopUpTransition = dpp.identity.createIdentityTopUpTransition(
          identity.getId(),
          outPoint,
        );
        identityTopUpTransition.signByPrivateKey(
          privateKey,
        );

        try {
          await client.getDAPIClient().applyStateTransition(
            identityTopUpTransition,
          );

          expect.fail('Error was not thrown');
        } catch (e) {
          const [error] = JSON.parse(e.metadata.get('errors'));
          expect(error.name).to.equal('IdentityAssetLockTransactionNotFoundError');
        }
      });

      it('should be able to top-up credit balance', async () => {
        const {
          transaction,
          privateKey,
        } = await createOutPointTx(
          1,
          walletAccount,
          identityRawPublicKey,
          walletPrivateKey,
        );

        const outPoint = transaction.getOutPointBuffer(0);

        const identityTopUpTransition = dpp.identity.createIdentityTopUpTransition(
          identity.getId(),
          outPoint,
        );
        identityTopUpTransition.signByPrivateKey(
          privateKey,
        );

        await client.getDAPIClient().sendTransaction(transaction.toBuffer());
        await waitForBlocks(client.getDAPIClient(), 1);

        await client.getDAPIClient().applyStateTransition(identityTopUpTransition);
      });

      it('should be able to create more documents after the top-up', async () => {
        const document = await client.platform.documents.create(
          'customContracts.niceDocument',
          identity,
          {
            name: 'Some Very Long Long Long Name',
          },
        );

        await client.platform.documents.broadcast({
          create: [document],
        }, identity);
      });
    });
  });
});
