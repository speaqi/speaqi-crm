import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts' / 'tourism'))
from acquire import Acquisition, classify_wtm, deduplicate, domain, institutional_email, public_url, wtm_record
from country_discovery import ancestry_reaches, tourism_organization_role, candidate_classes, ROOTS, FACILITIES
from prepare import coverage_sql
from official_directories import organization_names, capture_lines
from classification import explicit_ota_role
from ttg import classify_ttg, build_indexes, match_identity, legal_name_key


class AcquisitionTests(unittest.TestCase):
    def test_ttg_mixed_categories_do_not_turn_hotels_or_software_into_otas(self):
        self.assertEqual(classify_ttg('a&o Hostels','TOUR OPERATOR: TOUR OPERATOR INCOMING')[0],'accommodation')
        self.assertEqual(classify_ttg('Booking Software','TECNOLOGIA/WEB: TURISMO ONLINE/BOOKING & PRENOTAZIONI')[0],'technology')
        self.assertEqual(classify_ttg('Example Incoming','TOUR OPERATOR: TOUR OPERATOR INCOMING')[0],'dmc')
        self.assertEqual(classify_ttg('Ente turistico regionale della Carinzia','DESTINAZIONI/PROMOZIONE DEL TERRITORIO: ENTI DEL TURISMO ESTERI')[0],'rto')
        self.assertEqual(classify_ttg('Unknown company',None)[0],'other')

    def test_ttg_domain_or_legal_name_alone_is_a_review_candidate(self):
        catalog=[{'id':'one','name':'Example Travel','country_code':'IT','aliases':['Viaggi Esempio'],'website':'https://example.org/','external_ids':{'ttg_2026':'123'}}]
        idx=build_indexes(catalog)
        self.assertEqual(match_identity({'name':'Viaggi Esempio'},'IT',idx)[:2],('existing','exact_name_or_sourced_alias_country'))
        self.assertEqual(match_identity({'name':'Example Travel S.R.L.','website':'https://example.org/'},'IT',idx)[0],'review')
        self.assertEqual(match_identity({'name':'Example Travel S.R.L.'},'IT',idx)[0],'review')
        self.assertEqual(legal_name_key('Example Travel S.R.L.'),'example travel')
        self.assertEqual(match_identity({'name':'Different Company','website':'https://example.org/'},'IT',idx)[0],'review')
        self.assertEqual(match_identity({'name':'Example Travel','website':'https://different.org/'},'IT',idx)[0],'review')
        self.assertEqual(match_identity({'name':'Example Travel'},'FR',idx)[0],'review')
        self.assertEqual(match_identity({'name':'New Company'},None,idx)[0],'review')
        renamed={'name':'Renamed by the user','source_url':'https://www.ttgexpo.it/it/dettaglio-profilo/x?digitalProfileId=123'}
        self.assertEqual(match_identity(renamed,'IT',idx)[:2],('existing','stable_ttg_2026_profile_id'))
        self.assertEqual(match_identity(renamed,'FR',idx)[0],'review')

    def test_ota_role_requires_booking_identity_not_a_customer_or_mixed_tag(self):
        for description in ('online travel agency', 'Czech online travel agency and travel technology company', 'A global online marketplace to discover and book experiences. Supply partners offer tours.', 'online travel marketplace'):
            self.assertTrue(explicit_ota_role(description), description)
        for description in ('A software company for online travel agencies', 'Travel solutions for online travel agencies', 'We supply online travel agencies', 'Online travel agency software provider', 'Travel fare metasearch engine', 'defunct online travel agency', 'Hotel and wellness resort'):
            self.assertFalse(explicit_ota_role(description), description)

    def test_ota_fair_tag_alone_does_not_classify_a_hotel_or_software_vendor(self):
        for primary in ('Online Travel Agent (OTA)', 'Travel Agencies & OTA’s'):
            hit=self.fixture(name='Example Resort',primary=primary)
            hit['exhibitorDescription']='Hotel and wellness resort'
            self.assertIsNone(classify_wtm(hit)[0])
            hit['exhibitorDescription']='An online travel agency'
            self.assertEqual(classify_wtm(hit)[0],'ota')

    def fixture(self, name='Example DMC', country='Italy', primary='Destination Management Company (DMC)'):
        return {'id': 'exh-test', 'organisationGuid': 'org-test', 'companyName': name, 'exhibitorName': name, 'countryName': country, 'website': 'https://example.org/', 'exhibitorDescription': 'Destination management company', 'exhibitorFilters': {'Main company activity': {'lvl0': ['1:1: ' + primary]}}}

    def record(self, **changes):
        return {'kind': 'organization', 'name': 'Example DMC', 'country_code': 'IT', 'website': 'https://example.org/', 'email': None, 'phone': None, 'aliases': [], 'external_ids': {'wtm': 'org-test'}, 'evidence': {'source_url': 'https://example.org/source'}, **changes}

    def test_seller_targeting_dmcs_is_not_a_dmc(self):
        hit = self.fixture(primary='Technology')
        hit['exhibitorFilters']['Product Groups'] = {'lvl0': ['1:1: Destination Management Company (DMC)']}
        self.assertIsNone(classify_wtm(hit)[0])

    def test_edition_specific_primary_activity_fields_are_normalized(self):
        for key, value, expected in [('Company Activity','Destination Management Company (DMC)','dmc'), ('Company activity','Tourism organisation','dmo')]:
            hit=self.fixture(name='Public Destination Organization')
            hit['exhibitorDescription']='Destination promotion body'
            hit['exhibitorFilters']={key:{'lvl0':['1:1: '+value]}}
            self.assertEqual(classify_wtm(hit)[0],expected)

    def test_mixed_operator_and_technology_category_stays_unclassified(self):
        hit=self.fixture(primary='Technology')
        hit['exhibitorDescription']='A travel operator backed by direct DMC operations'
        self.assertEqual(classify_wtm(hit)[0],'other')

    def test_software_marketplace_does_not_become_destination_operator(self):
        hit=self.fixture(name='Example DMC Marketplace',primary='Wholesaler')
        hit['exhibitorDescription']='A marketplace connecting travel agents with destination management companies'
        self.assertIsNone(classify_wtm(hit)[0])

    def test_board_tag_does_not_override_explicit_commercial_identity(self):
        hit = self.fixture(primary='Tourism Board')
        self.assertEqual(classify_wtm(hit)[0], 'dmc')
        hit['exhibitorDescription'] = 'A tourism company selling tours'
        self.assertEqual(classify_wtm(hit)[0], 'other')

    def test_missing_country_is_held_instead_of_guessed_from_website(self):
        a = Acquisition('/tmp/speaqi-tourism-acquisition-unit')
        hit = self.fixture(country='Unspecified')
        hit['website'] = 'https://example.it/'
        result, reason = wtm_record(hit, 'london', {}, a.country_code)
        self.assertIsNone(result)
        self.assertEqual(reason, 'missing_or_unknown_country')

    def test_strong_source_identity_merges_name_variants_and_preserves_evidence(self):
        first = self.record()
        second = self.record(name='Example DMC Limited', evidence={'source_url': 'https://example.org/second'})
        rows = deduplicate([first, second])
        self.assertEqual(len(rows), 1)
        self.assertEqual(len(rows[0]['source_evidence']), 2)
        self.assertIn('Example DMC Limited', rows[0]['aliases'])

    def test_country_boundaries_and_shared_domains_do_not_silently_merge(self):
        rows = deduplicate([self.record(), self.record(country_code='FR'), self.record(name='Different Organization', external_ids={'wtm': 'org-other'})])
        self.assertEqual(len(rows), 3)

    def test_distinct_authoritative_ids_with_generic_labels_require_disambiguation(self):
        with self.assertRaisesRegex(ValueError,'disambiguation required'):
            deduplicate([self.record(name='Office du tourisme',external_ids={'wikidata':'Q123'}),self.record(name='Office du tourisme',external_ids={'wikidata':'Q456'})])

    def test_existing_source_evidence_survives_successive_merges(self):
        first=self.record(source_evidence=[{'source_url':'https://example.org/a'},{'source_url':'https://example.org/b'}])
        merged=deduplicate([first,self.record(evidence={'source_url':'https://example.org/c'})])
        self.assertEqual(len(merged[0]['source_evidence']),3)

    def test_country_synonyms_are_resolved_without_web_suffix_guessing(self):
        source=Acquisition('/tmp/speaqi-tourism-acquisition-unit')
        self.assertEqual(source.country_code('Northern Macedonia'),'MK')
        self.assertEqual(source.country_code('Cape Verde'),'CV')
        self.assertIsNone(source.country_code('www.example.it'))

    def test_stale_cache_requires_new_acquisition(self):
        import tempfile,os,time
        with tempfile.TemporaryDirectory() as root:
            source=Acquisition(root)
            path=source.save('cache.json',{'rows':[]})
            self.assertTrue(source.cached(path))
            os.utime(path,(time.time()-90000,time.time()-90000))
            self.assertFalse(source.cached(path))

    def test_ontology_cycles_do_not_create_fictional_organizations(self):
        parents={'Q900':['Q901'],'Q901':['Q900'],'Q902':['Q43229'],'Q903':['Q41176']}
        self.assertFalse(ancestry_reaches('Q900',parents,ROOTS))
        self.assertTrue(ancestry_reaches('Q902',parents,ROOTS))
        self.assertTrue(ancestry_reaches('Q903',parents,FACILITIES))

    def test_coverage_requires_the_specific_sourced_organization_identity(self):
        record=self.record(source_evidence=[{'source_url':'https://www.wikidata.org/wiki/Q123','fields':['name','type_code']}])
        edge={'organization_country':'IT','organization_wikidata':'Q456','covered_country':'IT','source_url':'https://www.wikidata.org/wiki/Q456'}
        with self.assertRaisesRegex(ValueError,'Unresolved sourced organization'):
            coverage_sql([record],[edge],'00000000-0000-0000-0000-000000000001')

    def test_coverage_payload_cannot_terminate_the_sql_block(self):
        record=self.record(name="Example ' $speaqi_explicit_coverage$",source_evidence=[{'source_url':'https://www.wikidata.org/wiki/Q123','fields':['name','type_code']}])
        edge={'organization_country':'IT','organization_wikidata':'Q123','covered_country':'FR','source_url':'https://www.wikidata.org/wiki/Q123'}
        sql=coverage_sql([record],[edge],'00000000-0000-0000-0000-000000000001')
        self.assertIn('do $speaqi_explicit_coverage_$',sql)
        self.assertIn("Example '' $speaqi_explicit_coverage$",sql)

    def test_repreparing_a_smaller_dataset_removes_stale_generated_batches(self):
        import tempfile,subprocess,json
        with tempfile.TemporaryDirectory() as root:
            folder=pathlib.Path(root);out=folder/'sql';out.mkdir()
            (out/'import-0001.sql').write_text('stale rejected data')
            (out/'operator-notes.txt').write_text('keep')
            dataset=folder/'input.json';dataset.write_text(json.dumps([self.record()]))
            subprocess.run([sys.executable,str(pathlib.Path(__file__).resolve().parents[1]/'scripts/tourism/prepare.py'),'--owner','00000000-0000-0000-0000-000000000001','--input',str(dataset),'--out',str(out)],check=True,capture_output=True)
            self.assertTrue((out/'import-0000.sql').exists())
            self.assertFalse((out/'import-0001.sql').exists())
            self.assertEqual((out/'operator-notes.txt').read_text(),'keep')

    def test_tourist_cities_and_tourism_schools_are_not_marketing_organizations(self):
        self.assertFalse(tourism_organization_role('Annaba','city in Algeria'))
        self.assertFalse(tourism_organization_role('École Internationale Example','private higher education establishment'))
        self.assertTrue(tourism_organization_role('National Tourism Office','government tourism agency'))

    def test_search_hits_need_an_explicit_tourism_mandate_in_their_identity(self):
        self.assertFalse(tourism_organization_role('American Society of International Law','professional association'))
        self.assertFalse(tourism_organization_role('Federal Ministry of Agriculture','agriculture ministry in Austria'))
        self.assertFalse(tourism_organization_role('Universidad Internacional de Turismo','education organization in Mexico City'))
        self.assertFalse(tourism_organization_role('Example Fly','German leisure airline owned by a tourism company'))
        self.assertFalse(tourism_organization_role('Minister of Culture and Tourism','ministerial office in the Government'))
        self.assertFalse(tourism_organization_role('Presbyterian University School of Tourism','academic department'))
        self.assertFalse(tourism_organization_role('Language Engineering Institute','body under the Culture, Tourism and Archives Department'))
        self.assertFalse(tourism_organization_role('Tourism and Travel','travel and transport agency'))
        self.assertFalse(tourism_organization_role('Example Travel','travel agency'))
        self.assertFalse(tourism_organization_role('Saigontourist Cable Television Company','television station and internet service provider operated by a tourism company'))
        self.assertFalse(tourism_organization_role('Example Tourism','travel company'))
        self.assertTrue(tourism_organization_role('Example DMC','inbound tour operator and travel agency'))
        self.assertTrue(tourism_organization_role('Example Travel','Chinese inbound travel agency'))
        self.assertTrue(tourism_organization_role('Office de tourisme de Montgenèvre','tourism organization'))
        self.assertTrue(tourism_organization_role('South Carolina State Parks','division of the tourism department'))

    def test_bounded_ontology_crawl_excludes_candidates_that_cannot_pass_role_checks(self):
        def entity(label,description,type_id):
            return {'labels':{'en':{'value':label}},'descriptions':{'en':{'value':description}},'claims':{'P31':[{'mainsnak':{'datavalue':{'value':{'id':type_id}}}}]}}
        entities={'Q1':entity('Example','city with tourism development','Q515'),'Q2':entity('National Tourism Office','government agency','Q900'),'Q3':entity('Tourism Company Person','company founder','Q5')}
        self.assertEqual(candidate_classes(entities),{'Q900'})

    def test_institutional_directory_names_do_not_import_people_or_generic_governments(self):
        self.assertEqual(organization_names(['Ministère du tourisme','Minister of Tourism','Government of Example','Web: 【4†Ministry of Tourism and Investment†example.gov】']),['Ministère du tourisme','Ministry of Tourism and Investment'])

    def test_missing_or_conflicting_directory_capture_lines_stop_the_import(self):
        import tempfile
        with tempfile.TemporaryDirectory() as root:
            path=pathlib.Path(root)/'capture.txt'
            path.write_text('L0: A\nL2: B\n')
            with self.assertRaisesRegex(ValueError,'missing lines'):
                capture_lines([path])
            path.write_text('L0: A\nL1: B\nL1: C\n')
            with self.assertRaisesRegex(ValueError,'Conflicting'):
                capture_lines([path])

    def test_private_and_credential_urls_are_rejected(self):
        for value in ['https://127.0.0.1/', 'http://10.0.0.1/', 'https://admin:pass@example.org/', 'https://host.internal/', 'javascript:alert(1)', 'http://example.org:9000/']:
            self.assertIsNone(public_url(value), value)
        self.assertEqual(public_url('www.example.org'), 'https://www.example.org/')

    def test_shared_platforms_are_not_identity_domains(self):
        self.assertEqual(domain('https://www.facebook.com/visit-example'), '')
        self.assertEqual(domain('https://www.example.org/about'), 'example.org')

    def test_only_source_published_institutional_mailboxes_are_retained(self):
        self.assertEqual(institutional_email('INFO@example.org'), 'info@example.org')
        self.assertIsNone(institutional_email('john.smith@example.org'))
        self.assertIsNone(institutional_email('info@example.org; private@example.org'))

    def test_directory_is_not_marked_complete_when_a_page_is_truncated(self):
        class Source(Acquisition):
            def configuration(self, edition):
                return {'context': {'eventId': 'evt-test', 'eventEditionId': 'eve-test', 'interfaceLocale': 'en-GB', 'eventEditionName': 'Fixture'}, 'algoliaConfig': {'appId': 'XD0U5M6Y4R', 'apiKey': 'public-test-only'}}, 'https://www.wtm.com/london/en-gb/exhibitor-directory.html'

            def request(self, url, payload=None, headers=None):
                if url.endswith('robots.txt'):
                    return b'User-agent: *\nAllow: /\n'
                return b'{"nbHits":2,"nbPages":1,"hits":[{"objectID":"only-one"}]}'

        import tempfile
        with tempfile.TemporaryDirectory() as root:
            source = Source(root)
            with self.assertRaisesRegex(ValueError, 'incomplete'):
                source.wtm('london')
            self.assertEqual(source.receipts, [])


if __name__ == '__main__':
    unittest.main()
